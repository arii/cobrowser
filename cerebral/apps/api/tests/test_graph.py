import asyncio

from cerebral import correction, receipt as R
from cerebral.browser_client import ActionFailed, ControlLost, ScriptedDriver
from cerebral.graph import TAKEOVER_ACTION, WAIT_ACTION, run_skill, steps_satisfied
from cerebral.schemas import Action, RunStatus, StepOutcome, StepRecord
from conftest import make_run


def outcomes(run):
    return [r.outcome for r in run.receipt.records]


async def test_happy_path_produces_verified_receipt(skill, home, product, cart):
    drv = ScriptedDriver([home, product, cart])
    run = await run_skill(skill, make_run(skill), "sess", drv, judge=None)
    assert run.status == RunStatus.succeeded
    assert outcomes(run) == [StepOutcome.passed] * 2
    assert [r.index for r in run.receipt.records] == [0, 1]
    assert R.verify(run.receipt) == (True, [])
    assert run.receipt.receipt_link and run.receipt.success
    assert run.interventions == 0 and run.self_repairs == 0
    assert run.current_step == 2


async def test_failed_postcondition_repairs_then_hands_off(skill, home, product):
    # click never lands on the product page: first retry via repair, then handoff
    drv = ScriptedDriver([home, home, home, home])
    run = await run_skill(skill, make_run(skill), "sess", drv, judge=None)
    assert run.status == RunStatus.awaiting_human
    assert run.interventions == 1
    assert run.self_repairs == 1  # one repair attempt was made, even though it ended in handoff
    assert outcomes(run) == [StepOutcome.failed, StepOutcome.handed_off]
    assert [r.repairs for r in run.receipt.records] == [0, 1]
    assert drv.control == ["human"]
    assert run.current_step == 0
    assert R.verify(run.receipt) == (True, [])


# ---------- finding 4: the failed attempt is in the chain and the retry is a real transition ----------

async def test_failed_attempt_is_sealed_before_repair_and_retry_starts_from_its_post_state(skill, home, search, product, cart):
    drv = ScriptedDriver([home, search, product, cart])
    run = await run_skill(skill, make_run(skill), "sess", drv, judge=None)
    assert run.status == RunStatus.succeeded
    assert outcomes(run) == [StepOutcome.failed, StepOutcome.repaired, StepOutcome.passed]
    failed, repaired = run.receipt.records[0], run.receipt.records[1]
    assert failed.pre_hash == R.snapshot_hash(home) and failed.post_hash == R.snapshot_hash(search)
    assert failed.repairs == 0 and repaired.repairs == 1
    assert repaired.pre_hash == failed.post_hash  # the retry acted from where the failed attempt left the page
    assert repaired.post_hash == R.snapshot_hash(product)
    assert any(v.status.value == "failed" for v in failed.post_verdicts)
    assert run.self_repairs == 1
    assert [r.index for r in run.receipt.records] == [0, 1, 2]
    assert R.verify(run.receipt) == (True, [])


# ---------- finding 10: wait_then_retry re-checks, it never re-acts ----------

async def test_wait_then_retry_does_not_repeat_the_action(skill, home, product, cart):
    # step 1's click lands, but "Your cart" has not rendered when the first post-snapshot is taken
    drv = ScriptedDriver([home, product, product, cart])
    run = await run_skill(skill, make_run(skill), "sess", drv, judge=None)
    assert run.status == RunStatus.succeeded
    assert [a.target for a in drv.actions] == ["role=link name=Widget", "role=button name=Add to cart"]
    assert drv.waits == [1500]
    assert outcomes(run) == [StepOutcome.passed, StepOutcome.failed, StepOutcome.repaired]
    retry = run.receipt.records[2]
    assert retry.action == WAIT_ACTION  # the record says what happened: a wait, not a second click
    assert retry.pre_hash == R.snapshot_hash(product) and retry.post_hash == R.snapshot_hash(cart)
    assert run.self_repairs == 1
    assert R.verify(run.receipt) == (True, [])


# ---------- finding 8: handoff records which step it stopped on ----------

async def test_handoff_on_a_resumed_run_sets_current_step(skill, home, product):
    run = make_run(skill)
    s0 = skill.steps[0]
    h = R.snapshot_hash(home)
    R.append(run.receipt, StepRecord(index=0, step_id=s0.id, step_name=s0.name, pre_hash=h, post_hash=h,
                                     action=s0.action, outcome=StepOutcome.passed, prev_link=""))
    drv = ScriptedDriver([product, product, product])  # cart text never appears
    run = await run_skill(skill, run, "sess", drv, judge=None, start_step=1)
    assert run.status == RunStatus.awaiting_human
    assert run.current_step == 1
    assert outcomes(run) == [StepOutcome.passed, StepOutcome.failed, StepOutcome.handed_off]
    assert [r.index for r in run.receipt.records] == [0, 1, 2]
    assert all(r.step_id == skill.steps[1].id for r in run.receipt.records[1:])
    assert R.verify(run.receipt) == (True, [])


async def test_run_skill_sets_current_step_on_entry(skill, product, cart):
    run = make_run(skill)
    run.current_step = 0
    run = await run_skill(skill, run, "sess", ScriptedDriver([product, cart]), judge=None, start_step=1)
    assert run.current_step == 2 and run.status in (RunStatus.succeeded, RunStatus.failed)


# ---------- driver contract: ActionFailed / ControlLost ----------

async def test_action_failed_snapshot_becomes_post_state_and_repair_proceeds(skill, home, search, product, cart):
    drv = ScriptedDriver([home, ActionFailed("no such element", search), product, cart])
    run = await run_skill(skill, make_run(skill), "sess", drv, judge=None)
    assert run.status == RunStatus.succeeded
    assert outcomes(run) == [StepOutcome.failed, StepOutcome.repaired, StepOutcome.passed]
    assert run.receipt.records[0].post_hash == R.snapshot_hash(search)
    assert len(drv.actions) == 3  # failed click, retried click, add to cart


async def test_action_failed_without_snapshot_falls_back_to_driver_snapshot(skill, home, product, cart):
    drv = ScriptedDriver([home, ActionFailed("timeout", None), product, cart])
    run = await run_skill(skill, make_run(skill), "sess", drv, judge=None)
    assert run.status == RunStatus.succeeded
    assert run.receipt.records[0].outcome == StepOutcome.failed
    assert run.receipt.records[0].post_hash == R.snapshot_hash(home)


async def test_control_lost_routes_straight_to_handoff(skill, home):
    drv = ScriptedDriver([home, ControlLost("human holds control")])
    run = await run_skill(skill, make_run(skill), "sess", drv, judge=None)
    assert run.status == RunStatus.awaiting_human
    assert outcomes(run) == [StepOutcome.handed_off]  # no failed record, no repair
    rec = run.receipt.records[0]
    assert rec.action.kind == "noop" and "human holds control" in rec.action.description
    assert rec.pre_hash == rec.post_hash == R.snapshot_hash(home)
    assert run.interventions == 1 and run.self_repairs == 0 and run.current_step == 0
    assert drv.control == ["human"]
    assert R.verify(run.receipt) == (True, [])


# ---------- cooperative takeover via `stop` ----------

async def test_stop_set_before_acting_hands_off_without_acting(skill, home):
    stop = asyncio.Event()
    stop.set()
    drv = ScriptedDriver([home])
    run = await run_skill(skill, make_run(skill), "sess", drv, judge=None, stop=stop)
    assert run.status == RunStatus.awaiting_human
    assert drv.actions == []
    assert outcomes(run) == [StepOutcome.handed_off]
    assert run.receipt.records[0].action == TAKEOVER_ACTION
    assert run.receipt.records[0].step_id == skill.steps[0].id
    assert run.current_step == 0 and drv.control == ["human"]
    assert R.verify(run.receipt) == (True, [])


async def test_stop_set_mid_run_hands_off_before_the_next_step(skill, home, product, cart):
    stop = asyncio.Event()

    class TakeoverDriver(ScriptedDriver):
        async def act(self, session_id, action):
            snap = await super().act(session_id, action)
            stop.set()  # the human presses "Take over" while step 0's click is in flight
            return snap

    drv = TakeoverDriver([home, product, cart])
    run = await run_skill(skill, make_run(skill), "sess", drv, judge=None, stop=stop)
    assert run.status == RunStatus.awaiting_human
    assert len(drv.actions) == 1
    assert outcomes(run) == [StepOutcome.passed, StepOutcome.handed_off]
    assert run.receipt.records[1].step_id == skill.steps[1].id
    assert run.receipt.records[1].action == TAKEOVER_ACTION
    assert run.current_step == 1
    assert R.verify(run.receipt) == (True, [])


async def test_stop_during_repair_hands_off_without_sealing_a_failed_attempt(skill, home):
    stop = asyncio.Event()

    class TakeoverDriver(ScriptedDriver):
        async def act(self, session_id, action):
            stop.set()
            return await super().act(session_id, action)

    drv = TakeoverDriver([home, home])
    run = await run_skill(skill, make_run(skill), "sess", drv, judge=None, stop=stop)
    assert outcomes(run) == [StepOutcome.handed_off]
    assert len(drv.actions) == 1 and run.self_repairs == 0


# ---------- finish: a handed-off step is satisfied by a recorded correction, not a flag ----------

def _handed_off(skill, home):
    run = make_run(skill)
    s0 = skill.steps[0]
    h = R.snapshot_hash(home)
    R.append(run.receipt, StepRecord(index=0, step_id=s0.id, step_name=s0.name, pre_hash=h, post_hash=h,
                                     action=s0.action, outcome=StepOutcome.handed_off, prev_link=""))
    run.status = RunStatus.awaiting_human
    run.current_step = 0
    run.interventions = 1
    return run


async def test_finish_accepts_a_human_corrected_record_after_the_handoff(skill, home, product, cart):
    run = _handed_off(skill, home)
    fix = Action(kind="click", target="role=link name=Widget deluxe")
    correction.build_correction_record(run, skill.steps[0], fix, home, product, verdicts=[])
    run.status = RunStatus.running
    run = await run_skill(skill, run, "sess", ScriptedDriver([product, cart]), judge=None, start_step=1)
    assert run.status == RunStatus.succeeded
    assert outcomes(run) == [StepOutcome.handed_off, StepOutcome.human_corrected, StepOutcome.passed]
    assert [r.index for r in run.receipt.records] == [0, 1, 2]
    assert R.verify(run.receipt) == (True, [])


async def test_finish_ignores_the_human_corrected_flag_on_a_handed_off_record(skill, home, product, cart):
    run = _handed_off(skill, home)
    run.receipt.records[0].human_corrected = True  # the old in-place marking; the fix itself is not in the chain
    R.seal_record(run.receipt.records[0])
    R.seal_receipt(run.receipt)
    run = await run_skill(skill, run, "sess", ScriptedDriver([product, cart]), judge=None, start_step=1)
    assert run.status == RunStatus.failed and not run.receipt.success
    assert R.verify(run.receipt) == (True, [])  # the receipt is sound; it just does not prove the step


def test_steps_satisfied_rules():
    def r(i, sid, outcome):
        return StepRecord(index=i, step_id=sid, step_name=sid, pre_hash="a", post_hash="b",
                          action=Action(kind="noop"), outcome=outcome, prev_link="")
    P, F, H, C, Rp = (StepOutcome.passed, StepOutcome.failed, StepOutcome.handed_off, StepOutcome.human_corrected,
                      StepOutcome.repaired)
    assert steps_satisfied([])
    assert steps_satisfied([r(0, "a", F), r(1, "a", Rp), r(2, "b", P)])
    assert steps_satisfied([r(0, "a", H), r(1, "a", C), r(2, "b", P)])
    assert not steps_satisfied([r(0, "a", F)])
    assert not steps_satisfied([r(0, "a", H), r(1, "b", P)])
    assert not steps_satisfied([r(0, "a", H), r(1, "b", C)])  # correction for a different step
    assert not steps_satisfied([r(0, "a", C), r(1, "a", H)])  # correction before the handoff does not count
    assert not steps_satisfied([r(0, "a", F), r(1, "a", H), r(2, "a", C), r(3, "b", F)])


# ---------- sealing: a receipt is sealed from the moment the graph takes it ----------

async def test_run_skill_seals_an_unsealed_receipt_before_acting(skill, home):
    """api.start_run persists a fresh receipt without a seal. If the driver dies before the first
    record is appended, the receipt still verifies because run_skill sealed it on entry."""
    from cerebral.schemas import Receipt, Run
    run = Run(skill_id=skill.id, skill_version=skill.version,
              receipt=Receipt(run_id="", skill_id=skill.id, skill_version=skill.version, genesis=R.GENESIS))
    run.receipt.run_id = run.id
    assert run.receipt.receipt_link == "" and R.verify(run.receipt)[0] is False
    drv = ScriptedDriver([home, RuntimeError("worker down")])
    try:
        await run_skill(skill, run, "sess", drv, judge=None)
    except RuntimeError:
        pass
    else:
        raise AssertionError("the driver error must propagate")
    assert run.receipt.records == [] and run.receipt.final_link == R.GENESIS
    assert R.verify(run.receipt) == (True, [])
