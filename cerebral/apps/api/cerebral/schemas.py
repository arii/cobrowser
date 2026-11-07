"""Typed contracts for skills, assertions, verdicts and receipts.

Everything the agent claims is expressed here as data, never as prose. These shapes are
mirrored by apps/browser/src/types.ts and apps/web/lib/api.ts; keep the three in sync by hand.
"""
from __future__ import annotations

from datetime import datetime, timezone
from enum import Enum
from typing import Any, Literal, Optional
from uuid import uuid4

from pydantic import BaseModel, Field


def now() -> str:
    return datetime.now(timezone.utc).isoformat()


def new_id(prefix: str) -> str:
    return f"{prefix}_{uuid4().hex[:10]}"


# ---------- page state ----------

class A11yNode(BaseModel):
    role: str
    name: str = ""
    value: str = ""


class NetworkEvent(BaseModel):
    method: str = "GET"
    url: str
    status: int


class Snapshot(BaseModel):
    """What the browser worker reports about the page at one instant."""
    url: str
    title: str = ""
    tree: list[A11yNode] = Field(default_factory=list)
    text: str = ""
    network: list[NetworkEvent] = Field(default_factory=list)
    screenshot_ref: Optional[str] = None  # path or URL to a stored image, never inline
    captured_at: str = Field(default_factory=now)
    # Worker diagnostics about how the tree was computed (elements scanned, hidden, emitted; how the page script
    # was reached). Logged with every pre/postcheck so an empty tree is explained; never part of any hash.
    capture: Optional[dict[str, Any]] = None


# ---------- actions ----------

class Action(BaseModel):
    kind: Literal["navigate", "click", "type", "select", "press", "wait", "noop"]
    target: Optional[str] = None  # a11y anchor: "role=button name=Add to cart"
    value: Optional[str] = None
    description: str = ""


# ---------- assertions ----------

class AssertionKind(str, Enum):
    url_matches = "url_matches"
    element_visible = "element_visible"
    text_present = "text_present"
    network_ok = "network_ok"
    semantic = "semantic"  # judged, fallback only


class Assertion(BaseModel):
    id: str = Field(default_factory=lambda: new_id("as"))
    kind: AssertionKind
    # expected must be non-empty: '' would make text_present / url_matches trivially true.
    # url_matches: regex | element_visible: "role=.. name=.. [value=..]" | text_present: substring
    # network_ok: "METHOD /path" or "/path" (any 2xx on that path passes) | semantic: natural-language claim
    expected: str = Field(min_length=1)
    source: Literal["derived", "human", "model"] = "derived"
    required: bool = True


class VerdictStatus(str, Enum):
    passed = "passed"
    failed = "failed"
    skipped = "skipped"


class Verdict(BaseModel):
    assertion_id: str
    kind: AssertionKind
    status: VerdictStatus
    method: Literal["deterministic", "judge"]
    evidence: str = ""  # what the verifier looked at, short
    judge_model: Optional[str] = None
    confidence: Optional[float] = None


# ---------- skills ----------

class Step(BaseModel):
    id: str = Field(default_factory=lambda: new_id("st"))
    name: str
    action: Action
    preconditions: list[Assertion] = Field(default_factory=list)
    postconditions: list[Assertion] = Field(default_factory=list)
    max_repairs: int = 1


class Skill(BaseModel):
    id: str = Field(default_factory=lambda: new_id("sk"))
    name: str
    goal: str
    site: str
    steps: list[Step]
    goal_checks: list[Assertion] = Field(default_factory=list)
    demo_id: str = ""  # the recorded demonstration this skill was derived from (runs/demos/<id>.json)
    version: int = 1
    history: list[dict[str, Any]] = Field(default_factory=list)  # corrections applied, newest last
    created_at: str = Field(default_factory=now)
    updated_at: str = Field(default_factory=now)


# ---------- demonstration trace ----------

class TraceEvent(BaseModel):
    before: Snapshot
    action: Action
    after: Snapshot


class Demo(BaseModel):
    id: str = Field(default_factory=lambda: new_id("dm"))
    name: str
    goal: str
    site: str
    events: list[TraceEvent] = Field(default_factory=list)
    started_at: str = Field(default_factory=now)
    finished_at: Optional[str] = None
    skill_id: str = ""  # set when finish derives a skill from this recording


# ---------- runs and receipts ----------

class StepOutcome(str, Enum):
    passed = "passed"
    repaired = "repaired"
    handed_off = "handed_off"
    failed = "failed"
    human_corrected = "human_corrected"  # appended after a co-browsing fix; never rewrites the handed_off record


class StepRecord(BaseModel):
    """One link in the receipt chain."""
    index: int
    step_id: str
    step_name: str
    pre_hash: str
    action: Action
    post_hash: str
    pre_verdicts: list[Verdict] = Field(default_factory=list)
    post_verdicts: list[Verdict] = Field(default_factory=list)
    outcome: StepOutcome
    repairs: int = 0
    human_corrected: bool = False
    prev_link: str  # hash of the previous record, or genesis
    link: str = ""  # hash of this record (filled by receipt.seal_record)
    at: str = Field(default_factory=now)


class Receipt(BaseModel):
    run_id: str
    skill_id: str
    skill_version: int
    genesis: str
    records: list[StepRecord] = Field(default_factory=list)
    goal_verdicts: list[Verdict] = Field(default_factory=list)
    final_link: str = ""  # link of the last record
    receipt_link: str = ""  # seal over (run_id, skill_id, skill_version, genesis, final_link, goal_verdicts, success)
    success: bool = False


class Correction(BaseModel):
    """A human fix applied during co-browsing. Merged into the skill as a diff."""
    step_id: str
    new_action: Optional[Action] = None
    new_postconditions: list[Assertion] = Field(default_factory=list)
    note: str = ""


class RunStatus(str, Enum):
    running = "running"
    awaiting_human = "awaiting_human"
    succeeded = "succeeded"
    failed = "failed"


class Run(BaseModel):
    id: str = Field(default_factory=lambda: new_id("run"))
    skill_id: str
    skill_version: int
    status: RunStatus = RunStatus.running
    current_step: int = 0
    session_id: str = ""  # browser worker session this run drives; corrections must not trust the client for it
    receipt: Receipt
    interventions: int = 0
    self_repairs: int = 0
    started_at: str = Field(default_factory=now)
    finished_at: Optional[str] = None


class LedgerEntry(BaseModel):
    run_id: str
    skill_id: str
    skill_version: int
    success: bool
    steps: int
    assertions_total: int
    assertions_passed: int
    interventions: int
    self_repairs: int
    judge_calls: int
    final_link: str
    at: str = Field(default_factory=now)
