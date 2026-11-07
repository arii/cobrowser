// HTTP for the Python API (snapshot/act/wait/control), recording endpoints for demonstrations and
// corrections (/record/*), + WebSocket for the canvas (frames and trace events out, input in).
//
// A session exists only after POST /sessions. Every other route answers 404 {error:"unknown_session"}
// (the socket closes with code 4404) for an id it does not know, instead of launching a Chromium for it.
import "./env.js";
import fs from "node:fs";
import path from "node:path";
import { Writable } from "node:stream";
import Fastify, { type FastifyReply } from "fastify";
import cors from "@fastify/cors";
import websocket from "@fastify/websocket";
import { HumanHasControl, Session } from "./session.js";
import { Action, type Snapshot } from "./types.js";

const API_URL = (process.env.API_URL ?? "http://localhost:8000").replace(/\/$/, "");

// Logs go to stdout (the launcher's log view) AND logs/worker.jsonl, so a debugging session can
// `tail -f logs/*.jsonl` across services. One JSON object per line. Request/response noise is off;
// every action, control change and recording event is logged explicitly below.
const LOG_DIR = path.resolve(import.meta.dirname, "../../../logs");
fs.mkdirSync(LOG_DIR, { recursive: true });
const logFile = fs.createWriteStream(path.join(LOG_DIR, "worker.jsonl"), { flags: "a" });
const tee = new Writable({
  write(chunk, _enc, cb) { process.stdout.write(chunk); logFile.write(chunk); cb(); },
});
const app = Fastify({ logger: { level: "info", stream: tee }, disableRequestLogging: true });
await app.register(cors, { origin: true });
await app.register(websocket);

const sessions = new Map<string, Session>();
const starting = new Map<string, Promise<Session>>(); // launches in flight, so two POST /sessions for one id share a Chromium

/** Create the session if it does not exist yet. Idempotent: an existing or launching id is returned as is. */
async function openSession(id: string): Promise<Session> {
  const existing = sessions.get(id);
  if (existing) return existing;
  let pending = starting.get(id);
  if (!pending) {
    pending = (async () => {
      const s = new Session(id);
      try {
        await s.start();
      } catch (e) {
        await s.close().catch(() => undefined);
        throw e;
      }
      sessions.set(id, s);
      return s;
    })().finally(() => starting.delete(id));
    starting.set(id, pending);
  }
  return pending;
}

/** Look up an existing session; sends 404 {error:"unknown_session"} and returns null when the id is unknown. */
function lookup(id: string, reply: FastifyReply): Session | null {
  const s = sessions.get(id);
  if (!s) {
    reply.code(404).send({ error: "unknown_session" });
    return null;
  }
  return s;
}

const errorMessage = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** An empty tree makes every element_visible check fail with "0 nodes scanned", so whenever one leaves the worker
 *  say why: how the page script was reached (`capture.source`) and what its walk saw (scanned / hidden / boxless). */
function noteEmptyTree(s: Session, snap: Snapshot, where: string) {
  if (snap.tree.length > 0) return;
  app.log.warn({ sessionId: s.id, where, url: snap.url, text_chars: snap.text.length, capture: snap.capture ?? null },
               "snapshot has an empty tree");
}

// POST /sessions {sessionId, url?}
//   200 {sessionId, control}: the only route that creates a session; an existing id is reused (and
//       navigated to `url` when given). 500 when Chromium could not be launched.
app.post<{ Body: { sessionId: string; url?: string } }>("/sessions", async (req) => {
  const s = await openSession(req.body.sessionId);
  if (req.body.url) await s.page.goto(req.body.url, { waitUntil: "domcontentloaded" });
  app.log.info({ sessionId: s.id, url: req.body.url ?? null, headless: process.env.HEADLESS !== "false" }, "session opened");
  return { sessionId: s.id, control: s.control };
});

// POST /snapshot {sessionId}
//   200 Snapshot | 404 unknown_session
app.post<{ Body: { sessionId: string } }>("/snapshot", async (req, reply) => {
  const s = lookup(req.body.sessionId, reply);
  if (!s) return reply;
  const snap = await s.snapshot();
  noteEmptyTree(s, snap, "snapshot");
  return snap;
});

// POST /act {sessionId, action}
//   200 Snapshot              the action was actually performed (by its anchor, or by the Stagehand
//                             natural-language fallback from `description`)
//   400 {error:"invalid_action", issues}
//   404 {error:"unknown_session"}
//   409 {error:"human_has_control", raced}   control is not "agent"; `raced` when a human took over while
//                             the action was running (the step must not count as done)
//   422 {error, snapshot}     could not be performed: anchor failed and the fallback failed or was not
//                             possible. `snapshot` is the page afterwards, for the verifier.
// A failure is never reported as 200.
app.post<{ Body: { sessionId: string; action: unknown } }>("/act", async (req, reply) => {
  const s = lookup(req.body.sessionId, reply);
  if (!s) return reply;
  const parsed = Action.safeParse(req.body.action);
  if (!parsed.success) return reply.code(400).send({ error: "invalid_action", issues: parsed.error.issues });
  const action = parsed.data;
  const started = Date.now();
  const actLog = { sessionId: s.id, kind: action.kind, target: action.target ?? null, value: action.value ?? null };
  if (s.control !== "agent") {
    app.log.info({ ...actLog, status: 409 }, "act refused: human has control");
    return reply.code(409).send({ error: "human_has_control", raced: false });
  }

  let failure: string;
  try {
    const snap = await s.act(action);
    app.log.info({ ...actLog, status: 200, ms: Date.now() - started, url: snap.url, nodes: snap.tree.length }, "act ok");
    noteEmptyTree(s, snap, "act");
    return snap;
  } catch (e) {
    if (e instanceof HumanHasControl) {
      app.log.info({ ...actLog, status: 409, raced: e.raced }, "act refused mid-flight: human took over");
      return reply.code(409).send({ error: "human_has_control", raced: e.raced });
    }
    failure = errorMessage(e);
  }
  // Deterministic anchor failed: let Stagehand try the step from its description when that is possible.
  if (!action.description) {
    failure += "; no description for the natural-language fallback";
  } else if (!s.hasNaturalLanguageFallback) {
    failure += "; natural-language fallback not configured (set STAGEHAND_MODEL_API_KEY)";
  } else {
    try {
      return await s.actNatural(action.description);
    } catch (e) {
      if (e instanceof HumanHasControl) return reply.code(409).send({ error: "human_has_control", raced: e.raced });
      failure += `; natural-language fallback failed: ${errorMessage(e)}`;
    }
  }
  const snapshot = await s.snapshot().catch((e) => {
    app.log.warn({ sessionId: s.id, err: errorMessage(e) }, "could not snapshot after failed action");
    return null;
  });
  if (snapshot) noteEmptyTree(s, snapshot, "act_failed");
  app.log.warn({ ...actLog, status: 422, ms: Date.now() - started, error: failure, url: snapshot?.url ?? null,
                 nodes: snapshot?.tree.length ?? null }, "act failed");
  return reply.code(422).send(snapshot ? { error: failure, snapshot } : { error: failure });
});

// POST /wait {sessionId, ms}
//   200 {ok:true} | 404 unknown_session
app.post<{ Body: { sessionId: string; ms: number } }>("/wait", async (req, reply) => {
  const s = lookup(req.body.sessionId, reply);
  if (!s) return reply;
  await s.page.waitForTimeout(req.body.ms);
  return { ok: true };
});

// POST /control {sessionId, who}
//   200 {sessionId, control}
//   404 unknown_session
//   500 {error, control}   starting/stopping the recorder threw; control was rolled back to its previous
//                          value so it is never left flipped next to a half-started recorder.
// Handing to the human waits (bounded) for the agent action in flight before flipping, and the recorder
// starts only after that, so an agent click is never captured as a human trace event.
app.post<{ Body: { sessionId: string; who: "agent" | "human" } }>("/control", async (req, reply) => {
  const s = lookup(req.body.sessionId, reply);
  if (!s) return reply;
  const who = req.body.who;
  const previous = s.control;
  await s.setControl(who);
  app.log.info({ sessionId: s.id, from: previous, to: who }, "control changed");
  // Every handoff is a demonstration of the fix: record while the human has control so the
  // correction can carry what they actually did. Handing back stops it; /record/stop drains it.
  try {
    if (who === "human" && !s.recorder.active) await s.recorder.start();
    if (who === "agent" && s.recorder.active) await s.recorder.stop();
  } catch (e) {
    await s.setControl(previous);
    app.log.error({ sessionId: s.id, who, err: errorMessage(e) }, "recorder failed on control change; control rolled back");
    return reply.code(500).send({ error: errorMessage(e), control: s.control });
  }
  return { sessionId: s.id, control: s.control };
});

// ---- demonstration recording ----
// POST /record/start {sessionId, demoId?, url?}: human takes control, recording begins. With `url`
// the worker navigates there first and records that as the opening step. With `demoId` every trace
// event is also forwarded to the Python API (POST /demos/{demoId}/events) as it happens.
//   200 {sessionId, control, recording, events}
//   404 unknown_session
//   500 {error, control}   the recorder could not start; control rolled back, forwarder removed.
const forwarders = new Map<string, () => void>();

app.post<{ Body: { sessionId: string; demoId?: string; url?: string } }>("/record/start", async (req, reply) => {
  const s = lookup(req.body.sessionId, reply);
  if (!s) return reply;
  forwarders.get(s.id)?.();
  forwarders.delete(s.id);
  if (s.recorder.active) await s.recorder.stop();
  const previous = s.control;
  await s.setControl("human"); // waits for the agent action in flight; nothing is recorded until it is done
  if (req.body.demoId) {
    const demoId = req.body.demoId;
    const off = s.recorder.onEvent((event, index) => {
      fetch(`${API_URL}/demos/${demoId}/events`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(event) })
        .then((r) => { if (!r.ok) app.log.warn({ demoId, index, status: r.status }, "api rejected trace event"); })
        .catch((e) => app.log.warn({ demoId, index, err: String(e) }, "could not forward trace event"));
    });
    forwarders.set(s.id, off);
  }
  try {
    if (req.body.url) {
      const url = req.body.url;
      await s.recorder.perform({ kind: "navigate", value: url, description: `open ${url}` },
        () => s.page.goto(url, { waitUntil: "domcontentloaded" }).then(() => undefined));
    } else {
      await s.recorder.start();
    }
  } catch (e) {
    forwarders.get(s.id)?.();
    forwarders.delete(s.id);
    await s.setControl(previous);
    app.log.error({ sessionId: s.id, err: errorMessage(e) }, "recorder failed to start; control rolled back");
    return reply.code(500).send({ error: errorMessage(e), control: s.control });
  }
  return { sessionId: s.id, control: s.control, recording: s.recorder.active, events: s.recorder.events };
});

// POST /record/stop {sessionId}
//   200 {sessionId, recording:false, events} | 404 unknown_session
app.post<{ Body: { sessionId: string } }>("/record/stop", async (req, reply) => {
  const s = lookup(req.body.sessionId, reply);
  if (!s) return reply;
  const events = await s.recorder.stop();
  forwarders.get(s.id)?.();
  forwarders.delete(s.id);
  return { sessionId: s.id, recording: false, events };
});

// GET /record/:id
//   200 {sessionId, recording, events} | 404 unknown_session
app.get<{ Params: { id: string } }>("/record/:id", async (req, reply) => {
  const s = lookup(req.params.id, reply);
  if (!s) return reply;
  return { sessionId: s.id, recording: s.recorder.active, events: s.recorder.events };
});

// GET /ws/:id (WebSocket)
//   server -> {type:"frame", data, metadata} | {type:"control", who, naturalLanguageFallback}
//             | {type:"trace", index, event} | {type:"error", message}
//   client -> {type:"mouse"|"key", params} (only honored while control === "human")
//   Unknown id: the socket is closed with code 4404 "unknown_session".
// close/error are wired before any await, so a viewer that leaves while the screencast is starting is
// still unsubscribed; every send checks the socket is still open.
app.get<{ Params: { id: string } }>("/ws/:id", { websocket: true }, async (socket, req) => {
  let closed = false;
  let stopScreencast: (() => void) | null = null;
  let offTrace: (() => void) | null = null;
  const teardown = () => {
    stopScreencast?.();
    stopScreencast = null;
    offTrace?.();
    offTrace = null;
  };
  socket.on("close", () => { closed = true; teardown(); });
  socket.on("error", (e: Error) => { closed = true; teardown(); app.log.warn({ err: e.message }, "canvas socket error"); });

  const s = sessions.get(req.params.id);
  if (!s) {
    socket.close(4404, "unknown_session");
    return;
  }
  const send = (msg: Record<string, unknown>) => {
    if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(msg));
  };
  socket.on("message", async (raw: Buffer) => {
    try {
      const ev = JSON.parse(raw.toString());
      await s.humanInput(ev);
    } catch (e) {
      send({ type: "error", message: errorMessage(e) });
    }
  });

  try {
    stopScreencast = await s.startScreencast((f) => send({ type: "frame", ...f }));
  } catch (e) {
    app.log.warn({ sessionId: s.id, err: errorMessage(e) }, "could not start screencast");
    send({ type: "error", message: `screencast unavailable: ${errorMessage(e)}` });
  }
  offTrace = s.recorder.onEvent((event, index) => send({ type: "trace", index, event }));
  if (closed) {
    teardown();
    return;
  }
  send({ type: "control", who: s.control, naturalLanguageFallback: s.hasNaturalLanguageFallback });
});

// GET /health: 200 {ok:true, sessions}
app.get("/health", async () => ({ ok: true, sessions: [...sessions.keys()] }));

const port = Number(process.env.BROWSER_PORT ?? process.env.PORT ?? 8010);
await app.listen({ port, host: "0.0.0.0" });

// A worker that outlives its launcher is the worst failure mode of this service: it keeps the shared Chromium
// profile open, so the next worker cannot start ("profile already in use"), and it keeps answering on its port
// with stale code. The desktop launcher's stop only kills its own wrapper, which re-parents this process to
// launchd (ppid 1). The `start` script runs node directly (no tsx wrapper process) so that is observable here:
// when the parent disappears after startup, close every session and exit. A process started detached (ppid 1
// from the beginning) is left alone.
const launcherPid = process.ppid;
if (launcherPid !== 1) {
  setInterval(() => {
    if (process.ppid === launcherPid) return;
    app.log.warn({ launcherPid, ppid: process.ppid, sessions: [...sessions.keys()] }, "launcher gone; shutting down worker");
    Promise.allSettled([...sessions.values()].map((s) => s.close()))
      .then(() => app.close())
      .finally(() => process.exit(0));
  }, 2000).unref();
}
