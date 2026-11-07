"""File-backed persistence: skills/, runs/, runs/demos/. One JSON file per object."""
from __future__ import annotations

from pathlib import Path
from typing import TypeVar

from pydantic import BaseModel

from .schemas import Demo, LedgerEntry, Run, RunStatus, Skill, now

ROOT = Path(__file__).resolve().parents[3]
SKILLS = ROOT / "skills"
RUNS = ROOT / "runs"
DEMOS = RUNS / "demos"  # raw demonstration traces: the recording a skill was derived from
LEDGER = RUNS / "ledger.jsonl"
T = TypeVar("T", bound=BaseModel)


def _write(path: Path, obj: BaseModel) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(obj.model_dump_json(indent=2))


def _read(path: Path, cls: type[T]) -> T:
    return cls.model_validate_json(path.read_text())


def save_skill(s: Skill) -> None: _write(SKILLS / f"{s.id}.json", s)
def load_skill(sid: str) -> Skill: return _read(SKILLS / f"{sid}.json", Skill)
def list_skills() -> list[Skill]: return [_read(p, Skill) for p in sorted(SKILLS.glob("sk_*.json"))]

def save_run(r: Run) -> None: _write(RUNS / f"{r.id}.json", r)
def load_run(rid: str) -> Run: return _read(RUNS / f"{rid}.json", Run)
def list_runs() -> list[Run]: return [_read(p, Run) for p in sorted(RUNS.glob("run_*.json"))]

def save_demo(d: Demo) -> None: _write(DEMOS / f"{d.id}.json", d)
def load_demo(did: str) -> Demo: return _read(DEMOS / f"{did}.json", Demo)
def list_demos() -> list[Demo]: return [_read(p, Demo) for p in sorted(DEMOS.glob("dm_*.json"))]


def abandon_running_runs() -> list[Run]:
    """Mark every persisted run still `running` as failed. For API startup: a run that was mid-step
    when the process died can never resume, and must not sit in the dashboard as running forever.
    Returns the runs it changed so the caller can ledger them."""
    from . import receipt as receipt_mod  # local import: receipt does not depend on store
    changed: list[Run] = []
    for run in list_runs():
        if run.status != RunStatus.running:
            continue
        run.status = RunStatus.failed
        run.finished_at = now()
        run.receipt.success = False
        receipt_mod.seal_receipt(run.receipt)
        save_run(run)
        changed.append(run)
    return changed


def append_ledger(e: LedgerEntry) -> None:
    LEDGER.parent.mkdir(parents=True, exist_ok=True)
    with LEDGER.open("a") as f:
        f.write(e.model_dump_json() + "\n")


def read_ledger() -> list[LedgerEntry]:
    if not LEDGER.exists():
        return []
    return [LedgerEntry.model_validate_json(l) for l in LEDGER.read_text().splitlines() if l.strip()]
