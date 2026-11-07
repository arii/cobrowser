"""correction.py: the receipt side of a co-browsing fix (append, never rewrite)."""
import pytest

from cerebral import correction, receipt as R
from cerebral.schemas import Action, AssertionKind, StepOutcome, StepRecord, Verdict, VerdictStatus
from conftest import make_run


def _append(run, step, outcome, h):
    R.append(run.receipt, StepRecord(index=R.next_index(run.receipt), step_id=step.id, step_name=step.name,
                                     pre_hash=h, post_hash=h, action=step.action, outcome=outcome, prev_link=""))


def test_validate_requires_a_handed_off_last_record_for_that_step(skill, home):
    run = make_run(skill)
    h = R.snapshot_hash(home)
    with pytest.raises(ValueError, match="no receipt records"):
        correction.validate_correction(run, skill.steps[0].id)
    _append(run, skill.steps[0], StepOutcome.passed, h)
    with pytest.raises(ValueError, match="not handed_off"):
        correction.validate_correction(run, skill.steps[0].id)
    _append(run, skill.steps[1], StepOutcome.handed_off, h)
    with pytest.raises(ValueError, match="handed off on"):
        correction.validate_correction(run, skill.steps[0].id)
    correction.validate_correction(run, skill.steps[1].id)  # ok


def test_build_appends_a_sealed_human_corrected_record(skill, home, product):
    run = make_run(skill)
    step = skill.steps[0]
    _append(run, step, StepOutcome.failed, R.snapshot_hash(home))
    _append(run, step, StepOutcome.handed_off, R.snapshot_hash(home))
    handed = run.receipt.records[-1].model_copy(deep=True)
    fix = Action(kind="click", target="role=link name=Widget deluxe")
    verdict = Verdict(assertion_id="x", kind=AssertionKind.url_matches, status=VerdictStatus.passed,
                      method="deterministic")

    rec = correction.build_correction_record(run, step, fix, home, product, [verdict])

    assert run.receipt.records[-1] is rec
    assert rec.outcome == StepOutcome.human_corrected and rec.human_corrected
    assert rec.index == handed.index + 1 and rec.step_id == step.id
    assert rec.action == fix
    assert rec.pre_hash == R.snapshot_hash(home) and rec.post_hash == R.snapshot_hash(product)
    assert rec.post_verdicts == [verdict] and rec.pre_verdicts == []
    assert rec.prev_link == handed.link and rec.link
    assert run.receipt.records[-2] == handed  # the handed_off record was not touched
    assert run.receipt.final_link == rec.link
    assert R.verify(run.receipt) == (True, [])


def test_build_refuses_when_the_run_is_not_awaiting_that_step(skill, home, product):
    run = make_run(skill)
    _append(run, skill.steps[0], StepOutcome.handed_off, R.snapshot_hash(home))
    with pytest.raises(ValueError):
        correction.build_correction_record(run, skill.steps[1], Action(kind="noop"), home, product, [])
    assert len(run.receipt.records) == 1
    assert R.verify(run.receipt) == (True, [])


def test_a_second_correction_on_the_same_handoff_is_rejected(skill, home, product):
    run = make_run(skill)
    step = skill.steps[0]
    _append(run, step, StepOutcome.handed_off, R.snapshot_hash(home))
    correction.build_correction_record(run, step, Action(kind="noop"), home, product, [])
    with pytest.raises(ValueError, match="not handed_off"):
        correction.build_correction_record(run, step, Action(kind="noop"), home, product, [])
