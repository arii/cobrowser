"""Subq adapter: fast typed decisions on the hot path.

Subq's Decisions API (model `subq-snap-1.1`, base https://api.subq.ai/v1/systemone) takes a
`state` plus named questions with explicit criteria and returns a probability per answer.
Two uses here:

  SubqJudge      a `noul` (yes/no) question: does the claim hold given the page evidence?
                 Preferred judge for `semantic` assertions: one call, a probability, auditable.
  decide_repair  a `choice` question after a postcondition fails: retry | wait_then_retry |
                 re_anchor | handoff. One round trip, typed result, deterministic fallback.

Without SUBQ_API_KEY both fall back to deterministic behaviour, so the loop never depends on
Subq being up. Request/response shapes follow docs.subq.ai/endpoints/decisions-api (Nov 2026):
POST {base} with {model, state, questions:{name:{type, instructions, criteria}}}; answers come
back as answers.<name>.noul (p of yes) or answers.<name>.{choice, probabilities, confidence}.
Subq documents no latency figure, so measure it before calling it realtime.
The return types are the contract the graph depends on.
"""
from __future__ import annotations

import os
from typing import Any, Literal

import httpx
from pydantic import BaseModel

from ..schemas import Action, Snapshot, Step, Verdict, VerdictStatus
from ..verifier import JUDGE_THRESHOLD

Strategy = Literal["retry", "wait_then_retry", "re_anchor", "handoff"]
STRATEGIES: tuple[str, ...] = ("retry", "wait_then_retry", "re_anchor", "handoff")


class RepairDecision(BaseModel):
    strategy: Strategy
    new_action: Action | None = None
    rationale: str = ""
    probabilities: dict[str, float] | None = None  # from Subq, when used
    source: Literal["subq", "policy"] = "policy"


class _Subq:
    def __init__(self) -> None:
        self.base = os.getenv("SUBQ_API_BASE", "https://api.subq.ai/v1/systemone").rstrip("/")
        self.key = os.getenv("SUBQ_API_KEY", "")
        self.model_name = os.getenv("SUBQ_MODEL", "subq-snap-1.1")

    @property
    def enabled(self) -> bool:
        return bool(self.key)

    async def ask(self, state: str, questions: dict[str, Any]) -> dict[str, Any]:
        async with httpx.AsyncClient(timeout=10) as c:
            r = await c.post(self.base, headers={"Authorization": f"Bearer {self.key}"},
                             json={"model": self.model_name, "state": state, "questions": questions})
            r.raise_for_status()
            return r.json().get("answers", {})


_client = _Subq()


# ---------- judge ----------

class SubqJudge:
    """Implements verifier.Judge. Fails closed on any error."""
    def __init__(self, client: _Subq | None = None) -> None:
        self.client = client or _client
        self.model_name = self.client.model_name

    @property
    def enabled(self) -> bool:
        return self.client.enabled

    async def judge(self, claim: str, evidence: str) -> tuple[bool, float, str]:
        if not self.enabled:
            return (False, 0.0, "judge disabled: SUBQ_API_KEY unset")
        try:
            answers = await self.client.ask(
                f"A browser automation just finished a step. Page evidence:\n{evidence}",
                {"holds": {"type": "noul", "instructions": f"Is this claim true of the page? {claim}",
                           "criteria": {"true": "The evidence clearly shows the claim holds.",
                                        "false": "The evidence does not clearly show the claim holds."}}},
            )
            p = float(answers.get("holds", {}).get("noul", 0.0))
        except Exception as e:
            return (False, 0.0, f"subq unavailable: {type(e).__name__}")
        return (p >= JUDGE_THRESHOLD, p, f"subq p(true)={p:.2f}")


# ---------- repair decision ----------

def _required_failures(step: Step, verdicts: list[Verdict]) -> list[Verdict]:
    """Failed verdicts that matter for repair: only those of a required postcondition.

    A derived network_ok is required=False and fails whenever the beacon has not fired yet; it
    must not push the policy from wait_then_retry to handoff. A verdict whose assertion the step
    does not know (e.g. a goal check) is treated as required, since it cannot be shown optional.
    """
    optional = {a.id for a in step.postconditions if not a.required}
    return [v for v in verdicts if v.status == VerdictStatus.failed and v.assertion_id not in optional]


def _policy(step: Step, verdicts: list[Verdict], attempt: int) -> RepairDecision:
    if attempt >= step.max_repairs:
        return RepairDecision(strategy="handoff", rationale="repair budget exhausted")
    failed = {v.kind.value for v in _required_failures(step, verdicts)}
    if failed <= {"element_visible", "text_present"}:
        return RepairDecision(strategy="wait_then_retry", rationale="target likely still loading")
    if "url_matches" in failed:
        return RepairDecision(strategy="retry", rationale="navigation did not land; retry once")
    return RepairDecision(strategy="handoff", rationale=f"unhandled failure kinds: {sorted(failed)}")


def _state(step: Step, verdicts: list[Verdict], snap: Snapshot, attempt: int) -> str:
    failed = [f"{v.kind.value}: {v.evidence}" for v in _required_failures(step, verdicts)]
    return (
        f"Browser automation step '{step.name}' performed action {step.action.kind} on "
        f"'{step.action.target or step.action.value}'. Attempt {attempt + 1} of {step.max_repairs + 1}.\n"
        f"Expected postconditions failed: {failed}.\n"
        f"Current URL: {snap.url}. Page title: {snap.title}.\n"
        f"Visible text (truncated): {snap.text[:1500]}"
    )


_STRATEGY_QUESTION = {
    "strategy": {
        "type": "choice",
        "instructions": "Which recovery strategy should the agent take for this failed step?",
        "criteria": {
            "retry": "The same action should be performed again immediately; the failure looks transient.",
            "wait_then_retry": "The page is still loading or animating; waiting ~1.5s then retrying will likely pass.",
            "re_anchor": "The target element exists but under a different label or role; re-locate it by description.",
            "handoff": "The page is in an unexpected state (error, login wall, layout change); a human must correct it.",
        },
    }
}


async def decide_repair(step: Step, verdicts: list[Verdict], snap: Snapshot, attempt: int) -> RepairDecision:
    if not _client.enabled or attempt >= step.max_repairs:
        return _policy(step, verdicts, attempt)
    try:
        answers = await _client.ask(_state(step, verdicts, snap, attempt), _STRATEGY_QUESTION)
        raw = answers.get("strategy", {}).get("probabilities", {}) or {}
        # Only the four strategies the graph knows; anything else Subq invents is dropped rather
        # than crashing RepairDecision's validation and with it the run.
        probs = {k: float(v) for k, v in raw.items() if k in STRATEGIES}
    except Exception as e:  # never let the sponsor call block the loop
        d = _policy(step, verdicts, attempt)
        d.rationale += f" (subq unavailable: {type(e).__name__})"
        return d
    if not probs:
        d = _policy(step, verdicts, attempt)
        d.rationale += " (subq returned no known strategy)"
        return d
    best = max(probs, key=probs.get)  # type: ignore[arg-type]
    new_action = None
    if best == "re_anchor":
        # keep the described intent, drop the stale anchor so the worker falls back to Stagehand act()
        new_action = Action(kind=step.action.kind, target=None, value=step.action.value,
                            description=step.action.description or step.name)
    return RepairDecision(strategy=best, new_action=new_action, probabilities=probs, source="subq",  # type: ignore[arg-type]
                          rationale=f"subq chose {best} p={probs[best]:.2f}")
