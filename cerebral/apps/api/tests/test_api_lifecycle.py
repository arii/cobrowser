"""Run lifecycle over the API: locked corrections, takeover, sealed receipts (findings 1, 2, 3, 9, 12, 24, 27, 28, 33)."""
import asyncio

import pytest
from fastapi.testclient import TestClient

from cerebral import api, receipt as receipt_mod, store
from cerebral.schemas import Receipt, Run, RunStatus, StepOutcome, StepRecord


class _Driver:
    def __init__(self, snapshot):
        self.control: list[str] = []
        self._snap = snapshot

    async def set_control(self, session_id: str, who: str) -> None:
        self.control.append(who)

    async def snapshot(self, session_id: str):
        return self._snap


@pytest.fixture
def client(tmp_path, monkeypatch, product):
    monkeypatch.setattr(store, "SKILLS", tmp_path / "skills")
    monkeypatch.setattr(store, "RUNS", tmp_path / "runs")
    monkeypatch.setattr(store, "DEMOS", tmp_path / "runs" / "demos")
    monkeypatch.setattr(store, "LEDGER", tmp_path / "runs" / "ledger.jsonl")
    drv = _Driver(product)
    monkeypatch.setattr(api, "driver", drv)
    monkeypatch.setattr(api, "_tasks", {})
    monkeypatch.setattr(api, "_stops", {})
    monkeypatch.setattr(api, "_locks", {})

    async def no_drive(*a, **k):
        return None
    monkeypatch.setattr(api, "_drive", no_drive)
    return TestClient(api.app), drv


def _handed_off_run(skill, home, session_id="s1") -> Run:
    run = Run(skill_id=skill.id, skill_version=skill.version, status=RunStatus.awaiting_human, session_id=session_id,
              receipt=Receipt(run_id="", skill_id=skill.id, skill_version=skill.version, genesis=receipt_mod.GENESIS))
    run.receipt.run_id = run.id
    step = skill.steps[0]
    h = receipt_mod.snapshot_hash(home)
    receipt_mod.append(run.receipt, StepRecord(index=0, step_id=step.id, step_name=step.name, pre_hash=h,
                                               action=step.action, post_hash=h, outcome=StepOutcome.handed_off, prev_link=""))
    run.interventions = 1
    return run


def test_correction_appends_record_and_keeps_handed_off_sealed(client, skill, home):
    c, drv = client
    store.save_skill(skill)
    run = _handed_off_run(skill, home)
    store.save_run(run)
    sealed_link = run.receipt.records[0].link

    r = c.post(f"/runs/{run.id}/correction", json={"step_id": skill.steps[0].id, "note": "clicked the right link"})
    assert r.status_code == 200, r.text
    out = Run.model_validate(r.json())
    assert [rec.outcome for rec in out.receipt.records] == [StepOutcome.handed_off, StepOutcome.human_corrected]
    assert out.receipt.records[0].link == sealed_link and not out.receipt.records[0].human_corrected
    assert receipt_mod.verify(out.receipt) == (True, [])
    assert out.skill_version == skill.version  # the version that ran, not the corrected one (finding 5)
    assert store.load_skill(skill.id).version == skill.version + 1
    assert drv.control == ["agent"]  # control handed back before anything was mutated


def test_correction_for_wrong_step_is_refused_and_changes_nothing(client, skill, home):
    c, drv = client
    store.save_skill(skill)
    run = _handed_off_run(skill, home)
    store.save_run(run)
    r = c.post(f"/runs/{run.id}/correction", json={"step_id": skill.steps[1].id})
    assert r.status_code == 409 and "handed off on" in r.json()["detail"]
    assert store.load_skill(skill.id).version == skill.version
    assert len(store.load_run(run.id).receipt.records) == 1
    assert drv.control == []


def test_correction_uses_the_runs_session_not_the_body(client, skill, home, monkeypatch):
    c, drv = client
    seen = []

    async def set_control(session_id, who):
        seen.append(session_id)
    monkeypatch.setattr(drv, "set_control", set_control)
    store.save_skill(skill)
    store.save_run(_handed_off_run(skill, home, session_id="real"))
    run_id = store.list_runs()[0].id
    r = c.post(f"/runs/{run_id}/correction", json={"step_id": skill.steps[0].id, "session_id": ""})
    assert r.status_code == 200 and seen == ["real"]


def test_correction_refused_while_agent_task_is_active(client, skill, home):
    c, _ = client
    store.save_skill(skill)
    run = _handed_off_run(skill, home)
    store.save_run(run)

    async def forever():
        await asyncio.sleep(3600)
    loop = asyncio.new_event_loop()
    task = loop.create_task(forever())
    api._tasks[run.id] = task
    try:
        r = c.post(f"/runs/{run.id}/correction", json={"step_id": skill.steps[0].id})
        assert r.status_code == 409 and "still active" in r.json()["detail"]
    finally:
        task.cancel()
        loop.close()


def test_takeover_requires_a_running_run(client, skill, home):
    c, _ = client
    store.save_skill(skill)
    run = _handed_off_run(skill, home)
    store.save_run(run)
    r = c.post(f"/runs/{run.id}/takeover")
    assert r.status_code == 409 and "not running" in r.json()["detail"]
    assert c.post("/runs/run_nope/takeover").status_code == 404


def test_takeover_with_no_driver_marks_the_run_failed(client, skill, home):
    c, _ = client
    store.save_skill(skill)
    run = _handed_off_run(skill, home)
    run.status = RunStatus.running
    store.save_run(run)
    r = c.post(f"/runs/{run.id}/takeover")
    assert r.status_code == 409
    after = store.load_run(run.id)
    assert after.status == RunStatus.failed and receipt_mod.verify(after.receipt) == (True, [])


def test_start_run_records_session_and_rejects_empty(client, skill):
    c, _ = client
    store.save_skill(skill)
    assert c.post(f"/skills/{skill.id}/run", json={"session_id": "  "}).status_code == 422
    r = c.post(f"/skills/{skill.id}/run", json={"session_id": "sess-1"})
    assert r.status_code == 200
    run = Run.model_validate(r.json())
    assert run.session_id == "sess-1" and run.receipt.receipt_link and receipt_mod.verify(run.receipt) == (True, [])


def test_verify_endpoint_returns_receipt_link_and_catches_forged_success(client, skill, home):
    c, _ = client
    run = _handed_off_run(skill, home)
    ok = c.post("/receipts/verify", json=run.receipt.model_dump(mode="json")).json()
    assert ok["ok"] and ok["receipt_link"] == run.receipt.receipt_link
    forged = run.receipt.model_copy(update={"success": True})
    bad = c.post("/receipts/verify", json=forged.model_dump(mode="json")).json()
    assert not bad["ok"]
