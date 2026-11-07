"""A correction that carries a recorded trace fills in the step's new action and postconditions."""
import pytest
from fastapi.testclient import TestClient

from cerebral import api, receipt as receipt_mod, store
from cerebral.schemas import (Action, AssertionKind, Receipt, Run, RunStatus, StepOutcome, StepRecord,
                              TraceEvent)


class _Driver:
    def __init__(self) -> None:
        self.control: list[str] = []

    async def set_control(self, session_id: str, who: str) -> None:
        self.control.append(who)


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setattr(store, "SKILLS", tmp_path / "skills")
    monkeypatch.setattr(store, "RUNS", tmp_path / "runs")
    monkeypatch.setattr(store, "LEDGER", tmp_path / "runs" / "ledger.jsonl")
    drv = _Driver()
    monkeypatch.setattr(api, "driver", drv)

    async def no_drive(*a, **k):  # the resumed run is the graph's business, not this test's
        return None
    monkeypatch.setattr(api, "_drive", no_drive)
    return TestClient(api.app), drv


def _handed_off_run(skill, home) -> Run:
    run = Run(skill_id=skill.id, skill_version=skill.version, status=RunStatus.awaiting_human,
              receipt=Receipt(run_id="", skill_id=skill.id, skill_version=skill.version, genesis=receipt_mod.GENESIS))
    run.receipt.run_id = run.id
    step = skill.steps[0]
    h = receipt_mod.snapshot_hash(home)
    receipt_mod.append(run.receipt, StepRecord(index=0, step_id=step.id, step_name=step.name, pre_hash=h,
                                               action=step.action, post_hash=h, outcome=StepOutcome.handed_off, prev_link=""))
    return run


def test_trace_becomes_new_action_and_postconditions(client, skill, home, product):
    tc, drv = client
    store.save_skill(skill)
    run = _handed_off_run(skill, home)
    store.save_run(run)

    fix = Action(kind="click", target="role=link name=Widget deluxe", description="click Widget deluxe")
    trace = [TraceEvent(before=home, action=fix, after=product)]
    r = tc.post(f"/runs/{run.id}/correction", json={
        "session_id": "s1", "step_id": skill.steps[0].id, "note": "link was renamed",
        "trace": [t.model_dump() for t in trace],
    })
    assert r.status_code == 200, r.text

    sk = store.load_skill(skill.id)
    assert sk.version == 2
    assert sk.steps[0].action == fix
    kinds = {a.kind for a in sk.steps[0].postconditions}
    assert AssertionKind.url_matches in kinds and AssertionKind.element_visible in kinds
    assert all(a.source == "human" for a in sk.steps[0].postconditions)
    assert sk.history[-1]["new_action"]["target"] == fix.target
    assert drv.control == ["agent"]
    out = store.load_run(run.id)
    assert out.receipt.records[-1].human_corrected and out.status == RunStatus.running


def test_explicit_fields_win_over_trace(client, skill, home, product):
    tc, _ = client
    store.save_skill(skill)
    run = _handed_off_run(skill, home)
    store.save_run(run)
    explicit = Action(kind="click", target="role=button name=Open", description="")
    r = tc.post(f"/runs/{run.id}/correction", json={
        "session_id": "s1", "step_id": skill.steps[0].id, "new_action": explicit.model_dump(),
        "new_postconditions": [{"kind": "text_present", "expected": "Widget"}],
        "trace": [TraceEvent(before=home, action=Action(kind="press", value="Enter"), after=product).model_dump()],
    })
    assert r.status_code == 200, r.text
    sk = store.load_skill(skill.id)
    assert sk.steps[0].action == explicit
    assert [a.expected for a in sk.steps[0].postconditions] == ["Widget"]
