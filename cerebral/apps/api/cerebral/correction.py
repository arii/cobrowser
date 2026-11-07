"""Receipt side of a co-browsing correction.

When a step hands off, the human fixes it on the shared session. The skill takes the fix as a
diff (api.correction); the receipt takes it as a new record. Nothing already sealed is rewritten:
the handed_off record stays as it was, and a `human_corrected` record is appended after it with
the human's action and the before/after state hashes. finish() treats a handed-off step as
satisfied only when such a record exists for the same step_id later in the chain.
"""
from __future__ import annotations

from . import receipt as receipt_mod
from .schemas import Action, Run, Snapshot, Step, StepOutcome, StepRecord, Verdict


def validate_correction(run: Run, step_id: str) -> None:
    """A correction may only target the step the run handed off on.

    Raises ValueError unless the receipt's last record is a handed_off record for `step_id`.
    """
    records = run.receipt.records
    if not records:
        raise ValueError("run has no receipt records; nothing was handed off")
    last = records[-1]
    if last.outcome != StepOutcome.handed_off:
        raise ValueError(f"last record is {last.outcome.value}, not handed_off; run is not awaiting a correction")
    if last.step_id != step_id:
        raise ValueError(f"correction targets step {step_id!r} but the run handed off on {last.step_id!r}")


def build_correction_record(run: Run, step: Step, action: Action, before_snapshot: Snapshot,
                            after_snapshot: Snapshot, verdicts: list[Verdict]) -> StepRecord:
    """Append the human's fix to the receipt as a sealed `human_corrected` record and return it.

    `action` is what the human did (the last recorded trace action), `before_snapshot` and
    `after_snapshot` span the whole correction, `verdicts` are the corrected step's postconditions
    checked against `after_snapshot`.
    """
    validate_correction(run, step.id)
    last = run.receipt.records[-1]
    rec = StepRecord(
        index=last.index + 1, step_id=step.id, step_name=step.name,
        pre_hash=receipt_mod.snapshot_hash(before_snapshot), action=action,
        post_hash=receipt_mod.snapshot_hash(after_snapshot),
        pre_verdicts=[], post_verdicts=verdicts,
        outcome=StepOutcome.human_corrected, repairs=0, human_corrected=True, prev_link="",
    )
    receipt_mod.append(run.receipt, rec)
    return rec
