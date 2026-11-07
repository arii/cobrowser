"""Subq adapter against the documented Decisions API shapes, with the HTTP client mocked."""
import pytest

from cerebral.adapters import subq
from cerebral.schemas import Action, Assertion, AssertionKind, Step, Verdict, VerdictStatus


class FakeSubq:
    enabled = True
    model_name = "subq-snap-1.1"

    def __init__(self, answers):
        self.answers = answers
        self.calls = []

    async def ask(self, state, questions):
        self.calls.append((state, questions))
        return self.answers


def failed(kind: AssertionKind, assertion_id: str = "a") -> Verdict:
    return Verdict(assertion_id=assertion_id, kind=kind, status=VerdictStatus.failed, method="deterministic")


@pytest.fixture
def step():
    return Step(name="add to cart", action=Action(kind="click", target="role=button name=Add to cart"), max_repairs=2)


def test_judge_threshold_is_shared_with_verifier():
    from cerebral.verifier import JUDGE_THRESHOLD
    assert subq.JUDGE_THRESHOLD is JUDGE_THRESHOLD


async def test_judge_reads_noul_probability():
    j = subq.SubqJudge(FakeSubq({"holds": {"type": "noul", "noul": 0.91}}))
    ok, p, why = await j.judge("widget is in the cart", "Your cart: Widget x 1")
    assert ok and p == 0.91
    _, questions = j.client.calls[0]
    assert questions["holds"]["type"] == "noul" and "instructions" in questions["holds"]


async def test_judge_below_threshold_fails_closed():
    j = subq.SubqJudge(FakeSubq({"holds": {"type": "noul", "noul": 0.4}}))
    ok, p, _ = await j.judge("claim", "evidence")
    assert not ok and p == 0.4


async def test_repair_uses_choice_probabilities(monkeypatch, step, product):
    fake = FakeSubq({"strategy": {"type": "choice", "choice": "re_anchor", "confidence": 0.8,
                                  "probabilities": {"retry": 0.05, "wait_then_retry": 0.1, "re_anchor": 0.8, "handoff": 0.05}}})
    monkeypatch.setattr(subq, "_client", fake)
    d = await subq.decide_repair(step, [failed(AssertionKind.element_visible)], product, attempt=0)
    assert d.source == "subq" and d.strategy == "re_anchor"
    assert d.probabilities["re_anchor"] == 0.8          # not polluted by `confidence`
    assert d.new_action is not None and d.new_action.target is None  # re-anchor drops the stale anchor
    assert fake.calls[0][1]["strategy"]["type"] == "choice"
    assert "instructions" in fake.calls[0][1]["strategy"]


async def test_repair_falls_back_to_policy_when_subq_errors(monkeypatch, step, product):
    class Boom(FakeSubq):
        async def ask(self, *_):
            raise RuntimeError("502")
    monkeypatch.setattr(subq, "_client", Boom({}))
    d = await subq.decide_repair(step, [failed(AssertionKind.url_matches)], product, attempt=0)
    assert d.source == "policy" and d.strategy == "retry" and "subq unavailable" in d.rationale


async def test_repair_budget_exhausted_hands_off_without_calling_subq(monkeypatch, step, product):
    fake = FakeSubq({})
    monkeypatch.setattr(subq, "_client", fake)
    d = await subq.decide_repair(step, [failed(AssertionKind.text_present)], product, attempt=2)
    assert d.strategy == "handoff" and fake.calls == []


# ---- finding 22: out-of-vocabulary strategies never reach RepairDecision ----

async def test_repair_ignores_unknown_strategies(monkeypatch, step, product):
    fake = FakeSubq({"strategy": {"probabilities": {"retry": 0.1, "escalate": 0.9}}})
    monkeypatch.setattr(subq, "_client", fake)
    d = await subq.decide_repair(step, [failed(AssertionKind.element_visible)], product, attempt=0)
    assert d.source == "subq" and d.strategy == "retry"
    assert "escalate" not in d.probabilities


async def test_repair_falls_back_to_policy_when_only_unknown_strategies(monkeypatch, step, product):
    fake = FakeSubq({"strategy": {"probabilities": {"escalate": 0.9, "abort": 0.1}}})
    monkeypatch.setattr(subq, "_client", fake)
    d = await subq.decide_repair(step, [failed(AssertionKind.element_visible)], product, attempt=0)
    assert d.source == "policy" and d.strategy == "wait_then_retry"
    assert "no known strategy" in d.rationale


# ---- finding 14: only required failures drive the policy ----

@pytest.fixture
def step_with_beacon():
    heading = Assertion(kind=AssertionKind.element_visible, expected="role=heading name=Your cart")
    beacon = Assertion(kind=AssertionKind.network_ok, expected="POST /g/collect", required=False)
    return Step(name="open cart", action=Action(kind="click", target="role=link name=Cart"),
                postconditions=[heading, beacon], max_repairs=2), heading, beacon


def test_policy_ignores_failed_optional_assertions(step_with_beacon):
    step, heading, beacon = step_with_beacon
    verdicts = [failed(AssertionKind.element_visible, heading.id), failed(AssertionKind.network_ok, beacon.id)]
    d = subq._policy(step, verdicts, attempt=0)
    assert d.strategy == "wait_then_retry"


def test_policy_still_hands_off_on_required_network_failure(step_with_beacon):
    step, heading, beacon = step_with_beacon
    beacon.required = True
    verdicts = [failed(AssertionKind.element_visible, heading.id), failed(AssertionKind.network_ok, beacon.id)]
    assert subq._policy(step, verdicts, attempt=0).strategy == "handoff"


def test_state_describes_only_required_failures(step_with_beacon, product):
    step, heading, beacon = step_with_beacon
    verdicts = [failed(AssertionKind.element_visible, heading.id), failed(AssertionKind.network_ok, beacon.id)]
    text = subq._state(step, verdicts, product, attempt=0)
    assert "element_visible" in text and "network_ok" not in text
