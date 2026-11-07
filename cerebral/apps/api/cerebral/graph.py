"""LangGraph run loop.

precheck -> act -> postcheck -> (pass) advance -> next step | finish
                             |-> (fail) repair -> retry / re_anchor: act again
                                             |-> wait_then_retry: wait, re-snapshot, postcheck again (no re-act)
                                             |-> handoff -> END (await human)

Every pass through postcheck appends a sealed StepRecord to the receipt: a failed attempt is
sealed as `failed` before any repair runs, and the retry's record starts from the failed
attempt's post-state so every record is a real transition. The agent never declares success;
`finish` runs goal checks and the verifier sets receipt.success. Handoff ends the graph; the API
resumes it from the next step after a correction arrives.

Driver contract: browser_client.ActionFailed (the worker could not perform the action) makes the
worker's snapshot the post-state so the postcheck decides; browser_client.ControlLost (a human
holds the session) routes straight to handoff. An optional `stop` event asks the graph to hand off
cooperatively before the next act instead of starting one (human takeover).
"""
from __future__ import annotations

import asyncio
from typing import Any, Literal, TypedDict

from langgraph.graph import END, StateGraph

from . import challenge, receipt as receipt_mod, runlog
from .adapters.subq import decide_repair
from .browser_client import ActionFailed, ControlLost, Driver
from .schemas import Action, Run, RunStatus, Skill, Snapshot, StepOutcome, StepRecord, Verdict, now
from .verifier import Judge, all_required_passed, check_all

WAIT_MS = 1500

# What the record says happened when the graph did not perform the step's action.
WAIT_ACTION = Action(kind="wait", value=str(WAIT_MS),
                     description="wait_then_retry: waited and re-checked without re-acting")
TAKEOVER_ACTION = Action(kind="noop", description="human takeover requested before the step acted")


class RunState(TypedDict, total=False):
    skill: Skill
    run: Run
    session_id: str
    step_index: int
    attempt: int
    pre_snapshot: Snapshot
    post_snapshot: Snapshot
    pre_verdicts: list[Verdict]
    post_verdicts: list[Verdict]
    action_override: Action | None
    repaired: bool
    acted: bool  # False until act() ran for the current step attempt
    route: Literal["act", "postcheck"] | None  # where repair sends the graph next
    halt: Literal["handoff", "failed"] | None


def steps_satisfied(records: list[StepRecord]) -> bool:
    """Every step in the chain reached a good end.

    passed / repaired / human_corrected records are good. A `failed` record is fine when a later
    record for the same step_id is good (the retry). A `handed_off` record is fine only when a later
    `human_corrected` record for the same step_id exists: the human's fix is recorded, never
    flagged onto the sealed handoff record.
    """
    good = {StepOutcome.passed, StepOutcome.repaired, StepOutcome.human_corrected}
    for i, r in enumerate(records):
        if r.outcome in good:
            continue
        later = [x for x in records[i + 1:] if x.step_id == r.step_id]
        if r.outcome == StepOutcome.handed_off:
            if not any(x.outcome == StepOutcome.human_corrected for x in later):
                return False
        elif not any(x.outcome in good for x in later):
            return False
    return True


def build_graph(driver: Driver, judge: Judge | None, stop: asyncio.Event | None = None):
    def step(state: RunState):
        return state["skill"].steps[state["step_index"]]

    def stopping() -> bool:
        return stop is not None and stop.is_set()

    async def precheck(state: RunState) -> RunState:
        snap = await driver.snapshot(state["session_id"])
        verdicts = await check_all(step(state).preconditions, snap, judge)
        out: RunState = {**state, "pre_snapshot": snap, "pre_verdicts": verdicts, "attempt": state.get("attempt", 0),
                         "acted": False, "halt": None, "action_override": None}
        runlog.event(state["run"].id, "precheck", step=state["step_index"], name=step(state).name[:60], url=snap.url,
                     nodes=len(snap.tree), text_chars=len(snap.text), verdicts=runlog.verdict_summary(verdicts),
                     capture=snap.capture)
        why = challenge.looks_like_challenge(snap)
        if why:
            runlog.event(state["run"].id, "challenge_detected", step=state["step_index"], why=why)
            # A CAPTCHA / bot check is never the agent's to attempt or to learn: hand off at once,
            # spend no repair budget, and say why in the record.
            out["halt"] = "handoff"
            out["action_override"] = Action(kind="noop", description=f"challenge page detected ({why}); handed off before acting")
        return out

    async def act(state: RunState) -> RunState:
        sid = state["session_id"]
        action = state.get("action_override") or step(state).action
        runlog.event(state["run"].id, "act", step=state["step_index"], kind=action.kind, target=action.target, value=action.value)
        try:
            snap = await driver.act(sid, action)
            runlog.event(state["run"].id, "act_ok", step=state["step_index"], url=snap.url, nodes=len(snap.tree))
        except ControlLost as e:
            runlog.event(state["run"].id, "act_refused", step=state["step_index"], reason=str(e)[:200])
            # The worker refused: a human holds the session. Nothing happened; record that and hand off.
            snap = await driver.snapshot(sid)
            refused = Action(kind="noop", description=f"refused by worker, human holds control: {e}")
            return {**state, "post_snapshot": snap, "acted": True, "action_override": refused, "halt": "handoff"}
        except ActionFailed as e:
            runlog.event(state["run"].id, "act_failed", step=state["step_index"], error=str(e)[:300],
                         url=e.snapshot.url if e.snapshot else None)
            # The worker tried and could not perform it. Its snapshot is the post-state; the postcheck decides.
            snap = e.snapshot if e.snapshot is not None else await driver.snapshot(sid)
        return {**state, "post_snapshot": snap, "acted": True}

    async def postcheck(state: RunState) -> RunState:
        verdicts = await check_all(step(state).postconditions, state["post_snapshot"], judge)
        ok = all_required_passed(verdicts, step(state).postconditions)
        runlog.event(state["run"].id, "postcheck", step=state["step_index"], passed=ok, url=state["post_snapshot"].url,
                     nodes=len(state["post_snapshot"].tree), text_chars=len(state["post_snapshot"].text),
                     verdicts=runlog.verdict_summary(verdicts), capture=state["post_snapshot"].capture)
        return {**state, "post_verdicts": verdicts}

    def seal(state: RunState, outcome: StepOutcome) -> RunState:
        s = step(state)
        run = state["run"]
        rec = StepRecord(
            index=receipt_mod.next_index(run.receipt), step_id=s.id, step_name=s.name,
            pre_hash=receipt_mod.snapshot_hash(state["pre_snapshot"]),
            action=state.get("action_override") or s.action,
            post_hash=receipt_mod.snapshot_hash(state["post_snapshot"]),
            pre_verdicts=state["pre_verdicts"], post_verdicts=state["post_verdicts"],
            outcome=outcome, repairs=state.get("attempt", 0), prev_link="",
        )
        receipt_mod.append(run.receipt, rec)
        return {**state, "run": run}

    async def repair(state: RunState) -> RunState:
        if stopping():
            return {**state, "halt": "handoff"}
        s, sid = step(state), state["session_id"]
        decision = await decide_repair(s, state["post_verdicts"], state["post_snapshot"], state["attempt"])
        runlog.event(state["run"].id, "repair_decision", step=state["step_index"], attempt=state["attempt"],
                     strategy=decision.strategy, source=decision.source, rationale=decision.rationale[:160])
        if decision.strategy == "handoff":
            return {**state, "halt": "handoff"}
        # The failed attempt is sealed before anything is repaired, and the retry starts from its post-state.
        state = seal(state, StepOutcome.failed)
        run = state["run"]
        run.self_repairs += 1
        pre = state["post_snapshot"]
        pre_verdicts = await check_all(s.preconditions, pre, judge)
        base: RunState = {**state, "run": run, "pre_snapshot": pre, "pre_verdicts": pre_verdicts,
                          "attempt": state["attempt"] + 1, "repaired": True}
        if decision.strategy == "wait_then_retry":
            # The action already happened; only the page may be late. Re-check, never re-act.
            await driver.wait(sid, WAIT_MS)
            snap = await driver.snapshot(sid)
            return {**base, "post_snapshot": snap, "action_override": WAIT_ACTION, "route": "postcheck"}
        return {**base, "action_override": decision.new_action, "route": "act"}

    async def advance(state: RunState) -> RunState:
        outcome = StepOutcome.repaired if state.get("repaired") else StepOutcome.passed
        state = seal(state, outcome)
        run = state["run"]
        run.current_step = state["step_index"] + 1
        return {**state, "run": run, "step_index": state["step_index"] + 1, "attempt": 0,
                "repaired": False, "action_override": None, "acted": False, "route": None, "halt": None}

    async def handoff(state: RunState) -> RunState:
        sid = state["session_id"]
        if not state.get("acted", False):
            # Takeover before this step acted: the page is as the agent found it; nothing happened.
            snap = await driver.snapshot(sid)
            s = step(state)
            state = {**state, "pre_snapshot": snap, "post_snapshot": snap,
                     "pre_verdicts": await check_all(s.preconditions, snap, judge),
                     "post_verdicts": await check_all(s.postconditions, snap, judge),
                     "action_override": state.get("action_override") or TAKEOVER_ACTION}
        state = seal(state, StepOutcome.handed_off)
        run = state["run"]
        run.current_step = state["step_index"]
        run.status = RunStatus.awaiting_human
        run.interventions += 1
        runlog.event(run.id, "handoff", step=state["step_index"], reason=(state.get("action_override") or TAKEOVER_ACTION).description[:200],
                     interventions=run.interventions)
        await driver.set_control(sid, "human")
        return {**state, "run": run}

    async def finish(state: RunState) -> RunState:
        run, skill = state["run"], state["skill"]
        snap = await driver.snapshot(state["session_id"])
        goal_verdicts = await check_all(skill.goal_checks, snap, judge)
        run.receipt.goal_verdicts = goal_verdicts
        run.receipt.success = (steps_satisfied(run.receipt.records)
                               and all_required_passed(goal_verdicts, skill.goal_checks))
        receipt_mod.seal_receipt(run.receipt)
        run.status = RunStatus.succeeded if run.receipt.success else RunStatus.failed
        run.finished_at = now()
        runlog.event(run.id, "finish", status=run.status.value, goal_verdicts=runlog.verdict_summary(goal_verdicts),
                     records=len(run.receipt.records), receipt_link=run.receipt.receipt_link[:16])
        return {**state, "run": run}

    def after_precheck(state: RunState) -> str:
        return "handoff" if stopping() or state.get("halt") == "handoff" else "act"

    def after_postcheck(state: RunState) -> str:
        if state.get("halt") == "handoff":
            return "handoff"
        if all_required_passed(state["post_verdicts"], step(state).postconditions):
            return "advance"
        return "repair"

    def after_repair(state: RunState) -> str:
        if state.get("halt") == "handoff":
            return "handoff"
        return state.get("route") or "act"

    def after_advance(state: RunState) -> str:
        if state["step_index"] >= len(state["skill"].steps):
            return "finish"
        return "handoff" if stopping() else "precheck"

    g = StateGraph(RunState)
    for name, fn in [("precheck", precheck), ("act", act), ("postcheck", postcheck), ("repair", repair),
                     ("advance", advance), ("handoff", handoff), ("finish", finish)]:
        g.add_node(name, fn)
    g.set_entry_point("precheck")
    # precondition failures are recorded, not blocking; the postcheck decides
    g.add_conditional_edges("precheck", after_precheck, {"act": "act", "handoff": "handoff"})
    g.add_edge("act", "postcheck")
    g.add_conditional_edges("postcheck", after_postcheck,
                            {"advance": "advance", "repair": "repair", "handoff": "handoff"})
    g.add_conditional_edges("repair", after_repair, {"act": "act", "postcheck": "postcheck", "handoff": "handoff"})
    g.add_conditional_edges("advance", after_advance,
                            {"precheck": "precheck", "finish": "finish", "handoff": "handoff"})
    g.add_edge("handoff", END)
    g.add_edge("finish", END)
    return g.compile()


async def run_skill(skill: Skill, run: Run, session_id: str, driver: Driver, judge: Judge | None,
                    start_step: int = 0, stop: asyncio.Event | None = None) -> Run:
    """Drive `run` from `start_step`. `stop`, when given and set, makes the graph hand off before the
    next action instead of performing it (cooperative takeover)."""
    run.current_step = start_step
    # A freshly created receipt (api.start_run) is unsealed; seal it now so the persisted receipt
    # verifies even if the driver fails before the first record is appended. Idempotent.
    receipt_mod.seal_receipt(run.receipt)
    graph = build_graph(driver, judge, stop)
    if start_step >= len(skill.steps):  # resumed after a correction on the last step: only goal checks remain
        out: Any = await graph.nodes["finish"].ainvoke(
            {"skill": skill, "run": run, "session_id": session_id, "step_index": start_step})
        return out["run"]
    init: RunState = {"skill": skill, "run": run, "session_id": session_id, "step_index": start_step,
                      "attempt": 0, "repaired": False, "action_override": None, "acted": False,
                      "route": None, "halt": None}
    out = await graph.ainvoke(init, config={"recursion_limit": 50 * max(1, len(skill.steps))})
    return out["run"]
