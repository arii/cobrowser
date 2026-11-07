"use client";
// Teach a skill by doing it once. Opens a shared session, hands control to the human, and shows each
// recorded (before, action, after) event as the worker captures it. Finish derives the skill.
import { useState } from "react";
import { useRouter } from "next/navigation";
import { api, type TraceEvent } from "@/lib/api";
import CoBrowseCanvas from "./CoBrowseCanvas";

export default function DemoRecorder() {
  const [name, setName] = useState("");
  const [goal, setGoal] = useState("");
  const [site, setSite] = useState("");
  const [demoId, setDemoId] = useState<string | null>(null);
  const [sessionId, setSessionId] = useState("");
  const [events, setEvents] = useState<TraceEvent[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const router = useRouter();

  const url = site.startsWith("http") ? site : `https://${site}`;

  async function start() {
    setBusy(true); setErr(null);
    try {
      const demo = await api.demoStart({ name, goal, site });
      const sid = `s_${Math.random().toString(36).slice(2, 10)}`;
      await api.openSession(sid);
      const started = await api.recordStart(sid, demo.id, url); // navigates and records that as step 1
      setEvents(started.events);
      setSessionId(sid);
      setDemoId(demo.id);
    } catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  }

  async function finish() {
    if (!demoId) return;
    setBusy(true); setErr(null);
    try {
      await api.recordStop(sessionId);
      const skill = await api.demoFinish(demoId);
      router.push(`/skills/${skill.id}`);
    } catch (e: any) { setErr(e.message); setBusy(false); }
  }

  function onTrace(ev: TraceEvent, index: number) {
    setEvents((cur) => { const next = [...cur]; next[index] = ev; return next.filter(Boolean); });
  }

  if (!demoId) {
    return (
      <div className="panel" style={{ maxWidth: 560 }}>
        <h1 style={{ marginTop: 0 }}>Demonstrate a skill</h1>
        <p className="muted">You perform the task once on a shared browser. Every click, keystroke and selection is recorded as a typed step with the page state before and after it. Nothing is inferred from pixels.</p>
        <label className="muted">Skill name</label>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Add a widget to the cart" />
        <label className="muted" style={{ display: "block", marginTop: 8 }}>Goal, in one sentence</label>
        <input value={goal} onChange={(e) => setGoal(e.target.value)} placeholder="The cart shows one Widget" />
        <label className="muted" style={{ display: "block", marginTop: 8 }}>Start URL</label>
        <input value={site} onChange={(e) => setSite(e.target.value)} placeholder="shop.example.com" />
        <div className="row" style={{ marginTop: 12 }}>
          <button onClick={start} disabled={busy || !name || !goal || !site}>{busy ? "Opening browser…" : "Start recording"}</button>
        </div>
        {err && <p className="mono" style={{ color: "var(--bad)" }}>{err}</p>}
      </div>
    );
  }

  return (
    <div className="grid">
      <div>
        <div className="row" style={{ justifyContent: "space-between", marginBottom: 8 }}>
          <h1 style={{ margin: 0 }}>{name} <span className="pill warn">recording</span></h1>
          <button onClick={finish} disabled={busy || events.length === 0}>{busy ? "Deriving skill…" : "Finish and derive skill"}</button>
        </div>
        <CoBrowseCanvas sessionId={sessionId} humanControl onTrace={onTrace} />
        <p className="muted" style={{ marginTop: 8 }}>You have control. Do the task as you normally would. Click the canvas first so it receives your keyboard.</p>
        {err && <p className="mono" style={{ color: "var(--bad)" }}>{err}</p>}
      </div>
      <div className="panel">
        <h2>Recorded steps</h2>
        {events.length === 0 && <p className="muted">Waiting for your first action…</p>}
        <div className="steps">
          {events.map((ev, i) => (
            <div key={i} className="step">
              <div><span className="muted">{i + 1}.</span> <strong>{ev.action.description || ev.action.kind}</strong> <span className="pill">{ev.action.kind}</span></div>
              {ev.action.target && <div className="mono">{ev.action.target}</div>}
              {ev.action.kind === "type" && ev.action.value !== undefined && <div className="mono">“{ev.action.value}”</div>}
              <div className="mono">{ev.before.url !== ev.after.url ? `→ ${ev.after.url}` : `${ev.after.tree.length} elements visible`}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
