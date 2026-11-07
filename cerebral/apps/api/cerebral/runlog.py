"""Per-run debug log: what the agent saw, decided and did, in order.

Every graph node and every API transition appends one JSON line to runs/<run_id>.log.jsonl and
echoes it to the process logger, so the same trail is in the terminal, in a file, and behind
GET /runs/{id}/log for the run page's debug panel. The receipt is the proof; this is the story.
"""
from __future__ import annotations

import json
import logging
from pathlib import Path
from typing import Any

from .schemas import Verdict, VerdictStatus, now
from .store import RUNS

log = logging.getLogger("cerebral")
if not log.handlers:
    _h = logging.StreamHandler()
    _h.setFormatter(logging.Formatter("%(asctime)s %(levelname)s %(message)s", "%H:%M:%S"))
    log.addHandler(_h)
    log.setLevel(logging.INFO)
    log.propagate = False


def _path(run_id: str) -> Path:
    return RUNS / f"{run_id}.log.jsonl"


def event(run_id: str, event_name: str, **fields: Any) -> dict:
    entry = {"at": now(), "run": run_id, "event": event_name, **fields}
    try:
        _path(run_id).parent.mkdir(parents=True, exist_ok=True)
        with _path(run_id).open("a") as f:
            f.write(json.dumps(entry, default=str) + "\n")
    except OSError:
        pass
    summary = " ".join(f"{k}={_short(v)}" for k, v in fields.items())
    log.info("%s %s %s", run_id, event_name, summary)
    return entry


def read(run_id: str, limit: int = 200) -> list[dict]:
    p = _path(run_id)
    if not p.exists():
        return []
    lines = p.read_text().splitlines()[-limit:]
    out = []
    for line in lines:
        try:
            out.append(json.loads(line))
        except json.JSONDecodeError:
            continue
    return out


def verdict_summary(verdicts: list[Verdict]) -> list[str]:
    """Compact, human-readable: 'url_matches:passed', 'element_visible:FAILED(0 nodes scanned)'."""
    out = []
    for v in verdicts:
        if v.status == VerdictStatus.passed:
            out.append(f"{v.kind.value}:passed")
        else:
            out.append(f"{v.kind.value}:{v.status.value.upper()}({v.evidence[:60]})")
    return out


def _short(v: Any, n: int = 160) -> str:
    s = v if isinstance(v, str) else json.dumps(v, default=str)
    return s if len(s) <= n else s[: n - 1] + "…"
