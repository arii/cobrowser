"use client";
// Live run: canvas on the left, receipt chain on the right. Polls the API; every step card is a
// sealed receipt record with its verdicts. On handoff the canvas unlocks and the correction form appears.
import { useEffect, useState } from "react";
import { api, resolveSessionId, type Run, type RunLogEvent, type Skill, type TraceEvent, type Verdict } from "@/lib/api";
import { ASSERTION_KINDS, KIND_HINT, buildPostconditions, emptyRow, isAssertionKind, type PostconditionRow } from "@/lib/postconditions";
import CoBrowseCanvas from "./CoBrowseCanvas";
import ReceiptChain from "./ReceiptChain";

export default function RunView({ runId }: { runId: string }) {
  const [run, setRun] = useState<Run | null>(null);
  const [skill, setSkill] = useState<Skill | null>(null);
  // Fallback only: the tab that launched the run stored the session id. The API's run.session_id wins when present.
  const [storedSession, setStoredSession] = useState<string>("");
  const [human, setHuman] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [events, setEvents] = useState<RunLogEvent[]>([]);
  const [showLog, setShowLog] = useState(true);
  const [note, setNote] = useState("");
  const [rows, setRows] = useState<PostconditionRow[]>([emptyRow()]);
  const [recorded, setRecorded] = useState<TraceEvent[]>([]);
  const [verify, setVerify] = useState<{ ok: boolean; problems: string[] } | null>(null);

  useEffect(() => {
    try { setStoredSession(sessionStorage.getItem(`session:${runId}`) ?? ""); } catch { setStoredSession(""); }
  }, [runId]);

  useEffect(() => {
    let alive = true;
    async function tick() {
      try {
        const r = await api.run(runId);
        if (!alive) return;
        setRun(r);
        if (!skill || skill.version !== r.skill_version) setSkill(await api.skill(r.skill_id));
        if (r.status === "awaiting_human") setHuman(true);
        api.runLog(runId).then((l) => alive && setEvents(l.events)).catch(() => undefined);
      } catch { /* keep polling */ }
    }
    tick();
    const t = setInterval(tick, 1200);
    return () => { alive = false; clearInterval(t); };
  }, [runId, skill?.version]);

  const sessionId = resolveSessionId(run, storedSession);

  async function resetRun() {
    if (!run) return;
    setBusy(true); setErr(null);
    try {
      const r = await api.abandon(run.id);
      setRun(r); setHuman(false);
    } catch (e) { setErr(messageOf(e)); } finally { setBusy(false); }
  }

  async function takeOver() {
    if (!run || !sessionId) return;
    setBusy(true); setErr(null);
    try {
      // The API flips the run to awaiting_human and hands the worker session to the human; the worker then
      // records the fix. Only after it agrees do we unlock the canvas (404: unknown run, 409: not running).
      const r = await api.takeover(run.id);
      setRun(r); setRecorded([]); setHuman(true);
    } catch (e) { setErr(messageOf(e)); } finally { setBusy(false); }
  }

  async function handBack() {
    if (!run || !skill || !sessionId) return;
    const step = skill.steps[run.current_step];
    if (!step) { setErr(`run points at step ${run.current_step + 1} but the skill has ${skill.steps.length}`); return; }
    const built = buildPostconditions(rows);
    if (!built.ok) { setErr(built.problems.join("; ")); return; }
    setBusy(true); setErr(null);
    try {
      // What the human actually did on the shared page. The API takes the last recorded action as the
      // step's new action and derives postconditions from the state change, unless typed ones are given.
      const { events: trace } = await api.recordStop(sessionId).catch(() => ({ events: [] as TraceEvent[] }));
      const r = await api.correction(run.id, { session_id: sessionId, step_id: step.id, new_postconditions: built.assertions, note, trace });
      setRun(r); setHuman(false); setNote(""); setRows([emptyRow()]); setRecorded([]);
    } catch (e) { setErr(messageOf(e)); /* stay in human mode so nothing typed or recorded is lost */ } finally { setBusy(false); }
  }

  async function doVerify() {
    if (!run) return;
    try { setVerify(await api.verify(run.receipt)); } catch (e) { setVerify({ ok: false, problems: [messageOf(e)] }); }
  }

  function setRow(i: number, patch: Partial<PostconditionRow>) {
    setRows((cur) => cur.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  }

  if (!run) return <p className="muted">Loading run…</p>;
  const status = run.status;
  const step = skill?.steps[run.current_step];
  return (
    <div className="grid">
      <div>
        <div className="row" style={{ justifyContent: "space-between", marginBottom: 8 }}>
          <h1 style={{ margin: 0 }}>{skill?.name ?? run.skill_id} <span className="muted">v{run.skill_version}</span></h1>
          <span className={`pill ${status === "succeeded" ? "ok" : status === "failed" ? "bad" : status === "awaiting_human" ? "warn" : ""}`}>{status}</span>
        </div>
        {sessionId ? <CoBrowseCanvas sessionId={sessionId} humanControl={human} onTrace={(ev, i) => setRecorded((r) => { const n = [...r]; n[i] = ev; return n.filter(Boolean); })} />
                   : <div className="panel muted">No live session is attached to this run. Take over and hand back need one.</div>}
        <div className="row" style={{ marginTop: 10 }}>
          {!human && status === "running" && (
            <button className="ghost" onClick={takeOver} disabled={busy || !sessionId} title={sessionId ? undefined : "No browser session is attached to this run"}>
              {busy ? "Taking over…" : "Take over"}
            </button>
          )}
          {human && (
            <div className="panel" style={{ width: "100%" }}>
              <h2>You have control. Fix the step, then hand back.</h2>
              <p className="muted">Step {run.current_step + 1}: {step?.name}</p>
              <div className="muted" style={{ marginBottom: 6 }}>
                {recorded.length === 0 ? "Recording: nothing captured yet. Perform the step on the canvas." :
                  <>Recorded {recorded.length} action{recorded.length === 1 ? "" : "s"}; the last one becomes the step: <span className="mono" style={{ color: "var(--fg)" }}>{recorded[recorded.length - 1].action.description}</span></>}
              </div>
              <textarea rows={2} placeholder="What did you change? (saved with the correction)" value={note} onChange={(e) => setNote(e.target.value)} />
              <div className="muted" style={{ marginTop: 8 }}>Optional new postconditions. Leave blank to derive them from what you did.</div>
              {rows.map((row, i) => (
                <div key={i} className="row" style={{ marginTop: 6, gap: 6 }}>
                  <select aria-label={`postcondition ${i + 1} kind`} value={row.kind}
                    onChange={(e) => { const v = e.target.value; if (isAssertionKind(v)) setRow(i, { kind: v }); }}>
                    {ASSERTION_KINDS.map((k) => <option key={k} value={k}>{k}</option>)}
                  </select>
                  <input aria-label={`postcondition ${i + 1} expected`} style={{ flex: 1 }} placeholder={KIND_HINT[row.kind]} value={row.expected}
                    onChange={(e) => setRow(i, { expected: e.target.value })} />
                  <button type="button" className="ghost" aria-label={`remove postcondition ${i + 1}`} disabled={rows.length === 1}
                    onClick={() => setRows((cur) => cur.filter((_, j) => j !== i))}>×</button>
                </div>
              ))}
              <div className="row" style={{ marginTop: 8, gap: 8 }}>
                <button type="button" className="ghost" onClick={() => setRows((cur) => [...cur, emptyRow()])}>Add postcondition</button>
                <button onClick={handBack} disabled={busy || !sessionId} title={sessionId ? undefined : "No browser session is attached to this run"}>
                  {busy ? "Handing back…" : "Hand back to agent"}
                </button>
              </div>
            </div>
          )}
        </div>
        {err && <p className="mono" role="alert" style={{ color: "var(--bad)" }}>{err}</p>}
        {(status === "running" || status === "awaiting_human") && (
          <p className="muted" style={{ marginTop: 8 }}>
            Stuck (browser session gone, nothing responding)?{" "}
            <button type="button" className="ghost" onClick={resetRun} disabled={busy}>Reset run</button>
            {" "}marks it failed with a sealed receipt so you can start a fresh one.
          </p>
        )}
      </div>
      <div className="panel">
        <div className="row" style={{ justifyContent: "space-between" }}>
          <h2>Receipt</h2>
          <button className="ghost" onClick={doVerify}>Verify chain</button>
        </div>
        {verify && <div className={`pill ${verify.ok ? "ok" : "bad"}`} style={{ marginBottom: 8 }}>{verify.ok ? "chain intact" : verify.problems.join("; ")}</div>}
        <ReceiptChain receipt={run.receipt} skill={skill} />
        <div className="panel" style={{ marginTop: 12 }}>
          <div className="row" style={{ justifyContent: "space-between" }}>
            <h2 style={{ margin: 0 }}>Debug log <span className="muted">({events.length})</span></h2>
            <button className="ghost" type="button" onClick={() => setShowLog((v) => !v)}>{showLog ? "Hide" : "Show"}</button>
          </div>
          {showLog && (
            <div className="mono" style={{ maxHeight: 320, overflow: "auto", marginTop: 8, display: "flex", flexDirection: "column", gap: 4 }}>
              {events.length === 0 && <span className="muted">No events yet. The agent logs every snapshot, action, verdict and decision here.</span>}
              {events.map((e, i) => <LogLine key={i} e={e} />)}
            </div>
          )}
        </div>
        <div className="row" style={{ marginTop: 10, gap: 14 }}>
          <span className="pill">{run.interventions} human</span>
          <span className="pill">{run.self_repairs} self-repairs</span>
          <span className="pill">{countJudge(run)} judge calls</span>
        </div>
      </div>
    </div>
  );
}

function messageOf(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

function countJudge(run: Run) {
  const all: Verdict[] = [...run.receipt.records.flatMap((r) => [...r.pre_verdicts, ...r.post_verdicts]), ...run.receipt.goal_verdicts];
  return all.filter((v) => v.method === "judge").length;
}

const BAD = new Set(["act_failed", "act_refused", "driver_crashed", "challenge_detected", "handoff", "abandoned"]);
function LogLine({ e }: { e: RunLogEvent }) {
  const { at, run: _run, event, ...rest } = e;
  const time = at.slice(11, 19);
  const color = BAD.has(event) ? "var(--bad)" : event === "finish" || event === "act_ok" ? "var(--ok)" : "var(--fg)";
  const fields = Object.entries(rest).map(([k, v]) => `${k}=${typeof v === "string" ? v : JSON.stringify(v)}`).join("  ");
  return (
    <div style={{ whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
      <span className="muted">{time}</span> <span style={{ color, fontWeight: 600 }}>{event}</span> <span>{fields}</span>
    </div>
  );
}
