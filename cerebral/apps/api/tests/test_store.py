"""store.abandon_running_runs: a run still `running` after a restart can never resume (finding 11)."""
from cerebral import receipt as R, store
from cerebral.schemas import RunStatus
from conftest import make_run


def test_abandon_running_runs_marks_them_failed_and_sealed(skill, tmp_path, monkeypatch):
    monkeypatch.setattr(store, "RUNS", tmp_path / "runs")
    running, waiting, done = make_run(skill), make_run(skill), make_run(skill)
    waiting.status = RunStatus.awaiting_human
    done.status = RunStatus.succeeded
    done.receipt.success = True
    R.seal_receipt(done.receipt)
    for r in (running, waiting, done):
        store.save_run(r)

    changed = store.abandon_running_runs()

    assert [r.id for r in changed] == [running.id]
    out = store.load_run(running.id)
    assert out.status == RunStatus.failed and out.finished_at and not out.receipt.success
    assert R.verify(out.receipt) == (True, [])
    assert store.load_run(waiting.id).status == RunStatus.awaiting_human
    assert store.load_run(done.id).status == RunStatus.succeeded
    assert store.abandon_running_runs() == []  # idempotent
