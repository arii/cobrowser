"""The ledger charges a run to the skill version that actually ran (finding 5)."""
from cerebral import ledger, store
from cerebral.schemas import RunStatus
from conftest import make_run


def test_entry_uses_the_receipt_skill_version(skill):
    run = make_run(skill, version=1)
    run.interventions = 1
    run.skill_version = 2  # a correction bumped the run to the fixed version
    e = ledger.entry_from_run(run)
    assert e.skill_version == 1
    assert e.interventions == 1
    assert e.final_link == run.receipt.final_link


def test_trends_key_series_on_the_version_that_ran(skill, tmp_path, monkeypatch):
    monkeypatch.setattr(store, "RUNS", tmp_path / "runs")
    monkeypatch.setattr(store, "LEDGER", tmp_path / "runs" / "ledger.jsonl")
    first = make_run(skill, version=1)
    first.interventions, first.skill_version, first.status = 1, 2, RunStatus.succeeded
    second = make_run(skill, version=2)
    second.status = RunStatus.succeeded
    ledger.record(first)
    ledger.record(second)
    series = ledger.trends()[skill.id]["series"]
    assert [(s["version"], s["interventions"]) for s in series] == [(1, 1), (2, 0)]
