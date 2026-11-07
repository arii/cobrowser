"""Meta (Llama) fallback judge: fails closed and applies the shared judge threshold (finding 13)."""
import pytest

from cerebral.adapters import meta
from cerebral.verifier import JUDGE_THRESHOLD


@pytest.fixture
def client(monkeypatch):
    monkeypatch.setenv("META_API_KEY", "test-key")
    return meta.MetaClient()


def _reply(client, raw):
    async def _chat(system, user):
        return raw
    client._chat = _chat


def _boom(client, exc):
    async def _chat(system, user):
        raise exc
    client._chat = _chat


async def test_disabled_without_key(monkeypatch):
    monkeypatch.delenv("META_API_KEY", raising=False)
    ok, p, why = await meta.MetaClient().judge("c", "e")
    assert (ok, p) == (False, 0.0) and "disabled" in why


async def test_confident_holds_passes(client):
    _reply(client, '{"holds": true, "confidence": 0.93, "reason": "cart lists Widget"}')
    ok, p, why = await client.judge("widget is in the cart", "Your cart: Widget x 1")
    assert ok and p == 0.93 and "cart lists Widget" in why


async def test_low_confidence_holds_fails_closed(client):
    _reply(client, '{"holds": true, "confidence": 0.05, "reason": "guess"}')
    ok, p, _ = await client.judge("c", "e")
    assert not ok and p == 0.05
    assert 0.05 < JUDGE_THRESHOLD


async def test_at_threshold_passes_below_fails(client):
    _reply(client, '{"holds": true, "confidence": %s}' % JUDGE_THRESHOLD)
    assert (await client.judge("c", "e"))[0]
    _reply(client, '{"holds": true, "confidence": %s}' % (JUDGE_THRESHOLD - 0.01))
    assert not (await client.judge("c", "e"))[0]


async def test_confident_does_not_hold_fails(client):
    _reply(client, '{"holds": false, "confidence": 0.99, "reason": "cart empty"}')
    ok, p, _ = await client.judge("c", "e")
    assert not ok and p == 0.99


@pytest.mark.parametrize("raw", [
    "not json at all",
    "[true, 0.9]",
    '"holds"',
    '{"holds": true, "confidence": "high"}',
    '{"holds": true, "confidence": 7}',
    '{"holds": true, "confidence": NaN}',
])
async def test_malformed_replies_fail_closed(client, raw):
    _reply(client, raw)
    ok, p, why = await client.judge("c", "e")
    assert (ok, p) == (False, 0.0)
    assert why.startswith("meta ")


@pytest.mark.parametrize("exc", [RuntimeError("502"), ConnectionError(), KeyError("choices"), TimeoutError()])
async def test_transport_errors_fail_closed(client, exc):
    _boom(client, exc)
    ok, p, why = await client.judge("c", "e")
    assert (ok, p) == (False, 0.0)
    assert why == f"meta unavailable: {type(exc).__name__}"


# ---------- generation calls: off the critical path, never raise, never emit an invalid Assertion ----------

from cerebral.schemas import Action


def _actions():
    return [Action(kind="click", target="role=link name=Widget"), Action(kind="click", target="role=button name=Add to cart")]


async def test_name_steps_falls_back_on_transport_error(client):
    _boom(client, RuntimeError("502"))
    assert await client.name_steps(_actions()) == ["click role=link name=Widget", "click role=button name=Add to cart"]


async def test_name_steps_replaces_blank_names_per_step(client):
    _reply(client, '{"names": ["Open widget", ""]}')
    assert await client.name_steps(_actions()) == ["Open widget", "click role=button name=Add to cart"]


async def test_name_steps_falls_back_on_wrong_length(client):
    _reply(client, '{"names": ["only one"]}')
    assert (await client.name_steps(_actions()))[0] == "click role=link name=Widget"


async def test_propose_goal_checks_drops_blank_claims_and_caps_at_three(client):
    # Assertion.expected has min_length=1: a blank claim used to raise ValidationError out of demo_finish.
    _reply(client, '{"claims": ["", "  ", "Widget is in the cart", 7, "Total shown", "Checkout offered", "extra"]}')
    checks = await client.propose_goal_checks("buy widget", "Your cart: Widget x 1")
    assert [a.expected for a in checks] == ["Widget is in the cart", "Total shown", "Checkout offered"]
    assert all(a.kind.value == "semantic" and a.source == "model" for a in checks)


@pytest.mark.parametrize("raw", ["not json", '{"claims": "one claim"}', "[]"])
async def test_propose_goal_checks_returns_nothing_on_malformed_reply(client, raw):
    _reply(client, raw)
    assert await client.propose_goal_checks("g", "t") == []


async def test_propose_goal_checks_returns_nothing_on_transport_error(client):
    _boom(client, ConnectionError())
    assert await client.propose_goal_checks("g", "t") == []
