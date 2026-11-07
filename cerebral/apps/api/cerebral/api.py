"""FastAPI surface for the canvas and the eval dashboard.

Run lifecycle: start_run -> _drive (LangGraph) -> succeeded | failed | awaiting_human
  awaiting_human -> correction (human fixed the step on the shared session) -> _drive resumes
  running        -> takeover  (human preempts the agent; the graph hands off cooperatively)
Every transition persists the run with a sealed receipt, so a crash or cancel never leaves an
unverifiable receipt or a run stuck in `running`.
"""
from __future__ import annotations

import asyncio
from contextlib import asynccontextmanager
from typing import Optional

from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from . import challenge, correction as correction_mod, ledger, receipt as receipt_mod, runlog, store
from .adapters.meta import MetaClient
from .adapters.subq import SubqJudge
from .browser_client import HttpDriver
from .derive import derive_postconditions, skill_from_demo
from .graph import run_skill
from .schemas import Action, Correction, Demo, Receipt, Run, RunStatus, Skill, Snapshot, TraceEvent, now
from .verifier import check_all

load_dotenv()

TAKEOVER_WAIT_S = 60.0  # upper bound on the agent's current action; HttpDriver.act times out at 90s


@asynccontextmanager
async def _lifespan(_: FastAPI):
    # A run that was mid-step when the previous process died can never resume (finding 11).
    for run in store.abandon_running_runs():
        ledger.record(run)
    yield


app = FastAPI(title="Cerebral API", version="0.1.0", lifespan=_lifespan)
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])

meta = MetaClient()
subq = SubqJudge()
driver = HttpDriver()
_demos: dict[str, Demo] = {}
_tasks: dict[str, asyncio.Task] = {}
_stops: dict[str, asyncio.Event] = {}  # cooperative takeover flags, one per active run
_locks: dict[str, asyncio.Lock] = {}  # serialize correction/takeover per run (finding 9)


def _judge():
    """Subq first (fast, probability), Meta as fallback, else None (semantic claims fail closed)."""
    if subq.enabled:
        return subq
    if meta.enabled:
        return meta
    return None


def _lock(run_id: str) -> asyncio.Lock:
    return _locks.setdefault(run_id, asyncio.Lock())


# ---------- demos ----------

class DemoStart(BaseModel):
    name: str
    goal: str
    site: str


class DemoSummary(BaseModel):
    """A recording without its events: enough to list and pick one."""
    id: str
    name: str
    goal: str
    site: str
    events: int
    started_at: str
    finished_at: Optional[str] = None
    skill_id: str = ""


def _summary(d: Demo) -> DemoSummary:
    return DemoSummary(id=d.id, name=d.name, goal=d.goal, site=d.site, events=len(d.events),
                       started_at=d.started_at, finished_at=d.finished_at, skill_id=d.skill_id)


@app.post("/demos/start", response_model=Demo)
async def demo_start(body: DemoStart) -> Demo:
    d = Demo(**body.model_dump())
    _demos[d.id] = d
    store.save_demo(d)
    return d


@app.post("/demos/{demo_id}/events", response_model=Demo)
async def demo_event(demo_id: str, ev: TraceEvent) -> Demo:
    # Written to disk after every event, not only at finish: a recording the human abandons, or an
    # API restart mid-demonstration, must not lose what was already captured.
    d = _get_demo(demo_id)
    d.events.append(ev)
    store.save_demo(d)
    return d


@app.get("/demos", response_model=list[DemoSummary])
async def demos() -> list[DemoSummary]:
    return [_summary(d) for d in store.list_demos()]


@app.get("/demos/{demo_id}", response_model=Demo)
async def demo(demo_id: str) -> Demo:
    return _get_demo(demo_id)


class DemoFinish(BaseModel):
    """Optional: the extension asks for the name and goal after the demonstration, not before."""
    name: Optional[str] = None
    goal: Optional[str] = None


@app.post("/demos/{demo_id}/finish", response_model=Skill)
async def demo_finish(demo_id: str, body: Optional[DemoFinish] = None) -> Skill:
    d = _get_demo(demo_id)
    if not d.events:
        raise HTTPException(400, "demo has no events")
    if body:
        if body.name:
            d.name = body.name
        if body.goal:
            d.goal = body.goal
    names = await meta.name_steps([e.action for e in d.events])
    goal_checks = await meta.propose_goal_checks(d.goal, d.events[-1].after.text)
    skill = skill_from_demo(d, names, goal_checks)
    store.save_skill(skill)
    d.skill_id = skill.id
    d.finished_at = now()
    store.save_demo(d)
    return skill


# ---------- skills ----------

@app.get("/skills", response_model=list[Skill])
async def skills() -> list[Skill]:
    return store.list_skills()


@app.get("/skills/{skill_id}", response_model=Skill)
async def skill(skill_id: str) -> Skill:
    return _get_skill(skill_id)


class RunStart(BaseModel):
    session_id: str


@app.post("/skills/{skill_id}/run", response_model=Run)
async def start_run(skill_id: str, body: RunStart) -> Run:
    if not body.session_id.strip():
        raise HTTPException(422, "session_id must not be empty")
    sk = _get_skill(skill_id)
    run = Run(skill_id=sk.id, skill_version=sk.version, session_id=body.session_id,
              receipt=Receipt(run_id="", skill_id=sk.id, skill_version=sk.version, genesis=receipt_mod.GENESIS))
    run.receipt.run_id = run.id
    receipt_mod.seal_receipt(run.receipt)
    store.save_run(run)
    runlog.event(run.id, "run_started", skill=sk.id, version=sk.version, steps=len(sk.steps), session=body.session_id)
    _tasks[run.id] = asyncio.create_task(_drive(sk, run, 0))
    return run


def _persist_failed(run: Run) -> None:
    run.status = RunStatus.failed
    run.finished_at = now()
    run.receipt.success = False
    receipt_mod.seal_receipt(run.receipt)
    store.save_run(run)
    ledger.record(run)


async def _drive(sk: Skill, run: Run, start_step: int) -> None:
    """Background driver. Any exit path persists a sealed receipt and a terminal or awaiting status."""
    stop = _stops.setdefault(run.id, asyncio.Event())
    try:
        run = await run_skill(sk, run, run.session_id, driver, _judge(), start_step, stop=stop)
    except asyncio.CancelledError:  # server shutdown or explicit cancel (finding 11)
        runlog.event(run.id, "driver_cancelled")
        _persist_failed(run)
        raise
    except Exception as e:  # worker down, network error: record a failed run rather than vanish
        runlog.event(run.id, "driver_crashed", error=f"{type(e).__name__}: {str(e)[:300]}")
        _persist_failed(run)
        raise
    store.save_run(run)
    if run.status in (RunStatus.succeeded, RunStatus.failed):
        ledger.record(run)
        _stops.pop(run.id, None)


# ---------- runs ----------

@app.get("/runs", response_model=list[Run])
async def runs() -> list[Run]:
    return store.list_runs()


@app.get("/runs/{run_id}", response_model=Run)
async def get_run(run_id: str) -> Run:
    return _get_run(run_id)


@app.get("/runs/{run_id}/receipt", response_model=Receipt)
async def get_receipt(run_id: str) -> Receipt:
    return _get_run(run_id).receipt


@app.get("/runs/{run_id}/log")
async def get_run_log(run_id: str, limit: int = 200) -> dict:
    """The agent's debug trail for this run (what it saw, decided and did), newest last."""
    _get_run(run_id)
    return {"run_id": run_id, "events": runlog.read(run_id, limit)}


@app.post("/runs/{run_id}/takeover", response_model=Run)
async def takeover(run_id: str) -> Run:
    """Human preempts a running agent. 404 unknown run, 409 not running / agent still finishing.

    Sets the run's stop flag; the graph hands off cooperatively after its current node (sealing a
    handed_off record, incrementing interventions, giving the worker's control to the human).
    """
    async with _lock(run_id):
        run = _get_run(run_id)
        if run.status != RunStatus.running:
            raise HTTPException(409, f"run is {run.status.value}, not running")
        task = _tasks.get(run_id)
        if task is None or task.done():
            # process restarted under the run; nothing is driving it, so it can only be abandoned
            _persist_failed(run)
            raise HTTPException(409, "no agent is driving this run; it has been marked failed")
        _stops.setdefault(run_id, asyncio.Event()).set()
        runlog.event(run_id, "takeover_requested")
        try:
            await asyncio.wait_for(asyncio.shield(task), timeout=TAKEOVER_WAIT_S)
        except asyncio.TimeoutError:
            raise HTTPException(409, "agent is still finishing its current action; retry takeover")
        except Exception:
            pass  # _drive already persisted a failed run
        run = _get_run(run_id)
        if run.status != RunStatus.awaiting_human:
            raise HTTPException(409, f"run finished as {run.status.value} before the takeover landed")
        return run


@app.post("/runs/{run_id}/abandon", response_model=Run)
async def abandon(run_id: str) -> Run:
    """Reset a run that cannot continue (its browser session is gone, the worker restarted, the human
    gave up). Cancels any driver task, marks the run failed with a sealed receipt, ledgers it, and
    releases the worker session if it still exists. 404 unknown run, 409 already finished."""
    async with _lock(run_id):
        run = _get_run(run_id)
        if run.status in (RunStatus.succeeded, RunStatus.failed):
            raise HTTPException(409, f"run already {run.status.value}")
        task = _tasks.pop(run_id, None)
        if task is not None and not task.done():
            _stops.setdefault(run_id, asyncio.Event()).set()
            task.cancel()
            try:
                await asyncio.wait_for(asyncio.shield(task), timeout=10)
            except Exception:
                pass
            run = _get_run(run_id)  # the cancelled driver persisted its own failed state
        if run.status not in (RunStatus.succeeded, RunStatus.failed):
            _persist_failed(run)
        runlog.event(run_id, "abandoned", by="user")
        _stops.pop(run_id, None)
        if run.session_id:
            try:
                await driver.set_control(run.session_id, "agent")
            except Exception:
                pass  # session already gone; nothing to release
        return _get_run(run_id)


class CorrectionBody(Correction):
    session_id: str = ""  # ignored when the run already knows its session (finding 28)
    # What the human did on the shared session while they had control, as recorded by the browser
    # worker (POST /record/stop). Fills in new_action / new_postconditions when they are not given.
    trace: list[TraceEvent] = []
    # None: decide from the trace (a bot-check interaction never rewrites the step). True forces the
    # merge, False makes this an unblock only: receipt gets the human_corrected record, skill unchanged,
    # and the agent re-runs the SAME step on the page the human left.
    apply_to_skill: Optional[bool] = None


@app.post("/runs/{run_id}/correction", response_model=Run)
async def correction(run_id: str, body: CorrectionBody) -> Run:
    """Human finished fixing the handed-off step. Merge the fix into the skill, append a
    human_corrected record to the receipt (never rewriting the sealed handed_off record), resume.

    404 unknown run/step, 409 not awaiting a human or wrong step, 502 worker unreachable.
    """
    async with _lock(run_id):
        run = _get_run(run_id)
        if run.status != RunStatus.awaiting_human:
            raise HTTPException(409, "run is not awaiting a human")
        task = _tasks.get(run_id)
        if task is not None and not task.done():
            raise HTTPException(409, "agent is still active on this run")
        try:
            correction_mod.validate_correction(run, body.step_id)  # finding 3 / 12
        except ValueError as e:
            raise HTTPException(409, str(e))
        sk = _get_skill(run.skill_id)
        step = next((s for s in sk.steps if s.id == body.step_id), None)
        if step is None:
            raise HTTPException(404, "unknown step")
        session_id = run.session_id or body.session_id
        if not session_id:
            raise HTTPException(409, "run has no browser session")

        # Fail fast before anything is mutated (finding 33): the worker must take control back.
        try:
            await driver.set_control(session_id, "agent")
        except Exception as e:
            raise HTTPException(502, f"browser worker refused control hand-back: {type(e).__name__}")

        # A hand-back that was really the human clearing a CAPTCHA / bot check is not a fix to the
        # step. Learning it would turn the skill into "drag the slider" (it happened). Keep the step,
        # record what the human did, and let the agent perform the original step on the cleared page.
        challenge_why = challenge.trace_is_challenge(body.trace) if body.trace else None
        apply = body.apply_to_skill if body.apply_to_skill is not None else challenge_why is None

        # What the human did, and the state it produced.
        if body.trace:
            # The last recorded action is the fix; the state change from first `before` to last `after`
            # is what the corrected step must now produce. Same derivation as a fresh demonstration.
            span = TraceEvent(before=body.trace[0].before, action=body.trace[-1].action, after=body.trace[-1].after)
            before, after = span.before, span.after
            if apply:
                body.new_action = body.new_action or span.action
                if not body.new_postconditions:
                    body.new_postconditions = derive_postconditions(span, step_name=step.name)
        else:
            try:
                after = await driver.snapshot(session_id)
            except Exception as e:
                raise HTTPException(502, f"browser worker snapshot failed: {type(e).__name__}")
            before = after

        if apply and body.new_action:
            step.action = body.new_action
        if apply and body.new_postconditions:
            for a in body.new_postconditions:
                a.source = "human"
            step.postconditions = body.new_postconditions

        if apply:
            # The corrected step is only credited if its postconditions hold on the page the human left.
            verdicts = await check_all(step.postconditions, after, _judge())
            action = body.new_action or step.action
            resume_from = run.current_step + 1
            sk.version += 1
            sk.updated_at = now()
            sk.history.append({"at": sk.updated_at, "run_id": run.id, "step_id": step.id, "note": body.note,
                               "from_version": run.skill_version, "to_version": sk.version,
                               "new_action": body.new_action.model_dump() if body.new_action else None,
                               "new_postconditions": [a.model_dump() for a in body.new_postconditions]})
            store.save_skill(sk)
        else:
            # Unblock only. The record carries what the human did; the step is still the agent's to do.
            human_action = body.trace[-1].action if body.trace else Action(kind="noop", description="human cleared the page")
            human_action = human_action.model_copy(update={
                "description": f"human unblocked the run ({challenge_why or 'no skill change requested'}); step not changed"})
            verdicts = []
            action = human_action
            resume_from = run.current_step
        correction_mod.build_correction_record(run, step, action, before, after, verdicts)
        runlog.event(run.id, "correction", step=step.id, applied_to_skill=apply, challenge=challenge_why,
                     trace_events=len(body.trace), action=action.description[:120], resume_from=resume_from,
                     verdicts=runlog.verdict_summary(verdicts))

        # run.skill_version stays the version that ran (finding 5); the ledger charges the
        # intervention to it. The new version is in the skill's history.
        run.status = RunStatus.running
        run.session_id = session_id
        _stops.pop(run.id, None)
        store.save_run(run)
        _tasks[run.id] = asyncio.create_task(_drive(sk, run, resume_from))
        return run


# ---------- verification + eval ----------

@app.post("/receipts/verify")
async def verify_receipt(r: Receipt) -> dict:
    """Recompute the chain and the receipt seal. receipt_link is the value to publish or compare;
    final_link alone does not commit to the outcome (finding 1)."""
    ok, problems = receipt_mod.verify(r)
    return {"ok": ok, "problems": problems, "final_link": r.final_link, "receipt_link": r.receipt_link}


@app.get("/ledger")
async def get_ledger() -> dict:
    return {"entries": [e.model_dump() for e in store.read_ledger()], "trends": ledger.trends()}


@app.get("/health")
async def health() -> dict:
    return {"ok": True, "judge": type(_judge()).__name__ if _judge() else None, "browser": driver.base}


# ---------- helpers ----------

def _get_demo(i: str) -> Demo:
    """Process memory first, then disk: a recording outlives the API process that took it."""
    if i not in _demos:
        try:
            _demos[i] = store.load_demo(i)
        except FileNotFoundError:
            raise HTTPException(404, "unknown demo")
    return _demos[i]


def _get_skill(i: str) -> Skill:
    try:
        return store.load_skill(i)
    except FileNotFoundError:
        raise HTTPException(404, "unknown skill")


def _get_run(i: str) -> Run:
    try:
        return store.load_run(i)
    except FileNotFoundError:
        raise HTTPException(404, "unknown run")
