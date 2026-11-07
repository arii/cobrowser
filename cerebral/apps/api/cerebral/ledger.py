"""Eval ledger: per-run metrics and per-skill trends. This is what the dashboard draws."""
from __future__ import annotations

from collections import defaultdict

from .schemas import LedgerEntry, Run, VerdictStatus
from .store import append_ledger, read_ledger


def entry_from_run(run: Run) -> LedgerEntry:
    r = run.receipt
    verdicts = [v for rec in r.records for v in rec.pre_verdicts + rec.post_verdicts] + r.goal_verdicts
    return LedgerEntry(
        run_id=run.id,
        skill_id=run.skill_id,
        # The version that actually ran. A correction bumps run.skill_version to the fixed
        # version, but the intervention belongs to the version that needed it.
        skill_version=r.skill_version,
        success=r.success,
        steps=len(r.records),
        assertions_total=len(verdicts),
        assertions_passed=sum(v.status == VerdictStatus.passed for v in verdicts),
        interventions=run.interventions,
        self_repairs=run.self_repairs,
        judge_calls=sum(v.method == "judge" for v in verdicts),
        final_link=r.final_link,
    )


def record(run: Run) -> LedgerEntry:
    e = entry_from_run(run)
    append_ledger(e)
    return e


def trends() -> dict:
    """Per-skill series in run order: interventions, pass rate, success. The demo chart."""
    by_skill: dict[str, list[LedgerEntry]] = defaultdict(list)
    for e in read_ledger():
        by_skill[e.skill_id].append(e)
    out = {}
    for sid, entries in by_skill.items():
        entries.sort(key=lambda e: e.at)
        out[sid] = {
            "runs": len(entries),
            "success_rate": sum(e.success for e in entries) / len(entries),
            "series": [{
                "run_id": e.run_id,
                "version": e.skill_version,
                "success": e.success,
                "interventions": e.interventions,
                "self_repairs": e.self_repairs,
                "pass_rate": (e.assertions_passed / e.assertions_total) if e.assertions_total else 0,
                "judge_calls": e.judge_calls,
                "at": e.at,
            } for e in entries],
        }
    return out
