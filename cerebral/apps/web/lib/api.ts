export const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";
export const BROWSER = process.env.NEXT_PUBLIC_BROWSER_URL ?? "http://localhost:8010";
export const BROWSER_WS = process.env.NEXT_PUBLIC_BROWSER_WS ?? "ws://localhost:8010";

export type Verdict = {
  assertion_id: string; kind: string; status: "passed" | "failed" | "skipped";
  method: "deterministic" | "judge"; evidence: string; judge_model?: string | null; confidence?: number | null;
};
export type StepRecord = {
  index: number; step_id: string; step_name: string; pre_hash: string; post_hash: string;
  pre_verdicts: Verdict[]; post_verdicts: Verdict[];
  // human_corrected: appended after a co-browsing fix; the handed_off record it follows is never rewritten
  outcome: "passed" | "repaired" | "handed_off" | "failed" | "human_corrected"; repairs: number; human_corrected: boolean;
  prev_link: string; link: string; at: string;
};
export type Receipt = {
  run_id: string; skill_id: string; skill_version: number; genesis: string;
  records: StepRecord[]; goal_verdicts: Verdict[]; final_link: string; success: boolean;
  receipt_link?: string; // seal over identity + outcome (run_id, skill_id, skill_version, genesis, final_link, goal_verdicts, success)
};
export type Run = {
  id: string; skill_id: string; skill_version: number;
  status: "running" | "awaiting_human" | "succeeded" | "failed";
  current_step: number; receipt: Receipt; interventions: number; self_repairs: number;
  started_at: string; finished_at?: string | null;
  session_id?: string; // browser worker session the run drives; the API is the source of truth for it
};
export type Action = { kind: string; target?: string | null; value?: string | null; description: string };
export type Step = { id: string; name: string; action: Action; postconditions: { id: string; kind: string; expected: string; source: string }[] };
// A demonstration trace event as the browser worker records it (mirrors schemas.TraceEvent; snapshots typed loosely here).
export type SnapshotLite = { url: string; title: string; tree: { role: string; name: string }[]; text: string };
export type TraceEvent = { before: SnapshotLite; action: Action; after: SnapshotLite };
export type Demo = { id: string; name: string; goal: string; site: string; events: TraceEvent[]; started_at: string; finished_at: string | null; skill_id: string };
export type DemoSummary = Omit<Demo, "events"> & { events: number };
export type Skill = { id: string; name: string; goal: string; site: string; version: number; steps: Step[]; demo_id: string };
export type LedgerPoint = { run_id: string; version: number; success: boolean; interventions: number; self_repairs: number; pass_rate: number; judge_calls: number; at: string };
export type RunLogEvent = { at: string; run: string; event: string } & Record<string, unknown>;
export type Ledger = { entries: unknown[]; trends: Record<string, { runs: number; success_rate: number; series: LedgerPoint[] }> };

/** The worker session a run view should drive: the API's record first, the launching tab's sessionStorage copy
 *  second, "" when neither knows (take over / hand back are disabled then). */
export function resolveSessionId(run: Pick<Run, "session_id"> | null | undefined, stored: string | null | undefined): string {
  return (run?.session_id ?? "").trim() || (stored ?? "").trim();
}

/** A non-2xx response. `status` lets callers branch (404/409/422); `message` is readable for the UI. */
export class ApiError extends Error {
  status: number;
  body: string;
  constructor(status: number, body: string, message: string) { super(message); this.name = "ApiError"; this.status = status; this.body = body; }
}

/** Turn a FastAPI error body into one line. A 422 carries `detail: [{loc, msg}]`; other errors carry `detail: "text"`. */
export function formatApiError(status: number, body: string): string {
  let detail: unknown;
  try { detail = (JSON.parse(body) as { detail?: unknown }).detail; } catch { detail = undefined; }
  if (typeof detail === "string") return `${status}: ${detail}`;
  if (Array.isArray(detail)) {
    const lines = detail.map((d) => {
      const item = d as { loc?: unknown[]; msg?: string };
      const loc = Array.isArray(item.loc) ? item.loc.filter((x) => x !== "body").join(".") : "";
      return loc ? `${loc}: ${item.msg ?? "invalid"}` : (item.msg ?? "invalid");
    });
    return `${status}: ${lines.join("; ")}`;
  }
  return `${status}${body ? ` ${body}` : ""}`;
}

async function j<T>(url: string, init?: RequestInit): Promise<T> {
  const r = await fetch(url, { ...init, headers: { "content-type": "application/json", ...(init?.headers ?? {}) }, cache: "no-store" });
  if (!r.ok) { const body = await r.text(); throw new ApiError(r.status, body, formatApiError(r.status, body)); }
  return r.json();
}

export const api = {
  skills: () => j<Skill[]>(`${API}/skills`),
  skill: (id: string) => j<Skill>(`${API}/skills/${id}`),
  runs: () => j<Run[]>(`${API}/runs`),
  run: (id: string) => j<Run>(`${API}/runs/${id}`),
  startRun: (skillId: string, sessionId: string) => j<Run>(`${API}/skills/${skillId}/run`, { method: "POST", body: JSON.stringify({ session_id: sessionId }) }),
  // The API flips the run to awaiting_human and hands the worker session to the human (404 unknown run, 409 not running).
  takeover: (runId: string) => j<Run>(`${API}/runs/${runId}/takeover`, { method: "POST" }),
  abandon: (runId: string) => j<Run>(`${API}/runs/${runId}/abandon`, { method: "POST" }),
  runLog: (runId: string) => j<{ run_id: string; events: RunLogEvent[] }>(`${API}/runs/${runId}/log?limit=200`),
  correction: (runId: string, body: unknown) => j<Run>(`${API}/runs/${runId}/correction`, { method: "POST", body: JSON.stringify(body) }),
  verify: (receipt: Receipt) => j<{ ok: boolean; problems: string[]; final_link: string; receipt_link?: string }>(`${API}/receipts/verify`, { method: "POST", body: JSON.stringify(receipt) }),
  ledger: () => j<Ledger>(`${API}/ledger`),
  openSession: (sessionId: string, url?: string) => j(`${BROWSER}/sessions`, { method: "POST", body: JSON.stringify({ sessionId, url }) }),
  setControl: (sessionId: string, who: "agent" | "human") => j(`${BROWSER}/control`, { method: "POST", body: JSON.stringify({ sessionId, who }) }),
  // demonstrations: the API owns the demo; the worker records on the shared session and forwards each event to it
  demoStart: (body: { name: string; goal: string; site: string }) => j<Demo>(`${API}/demos/start`, { method: "POST", body: JSON.stringify(body) }),
  demoFinish: (demoId: string) => j<Skill>(`${API}/demos/${demoId}/finish`, { method: "POST" }),
  demos: () => j<DemoSummary[]>(`${API}/demos`),
  demo: (demoId: string) => j<Demo>(`${API}/demos/${demoId}`),
  recordStart: (sessionId: string, demoId?: string, url?: string) =>
    j<{ recording: boolean; events: TraceEvent[] }>(`${BROWSER}/record/start`, { method: "POST", body: JSON.stringify({ sessionId, demoId, url }) }),
  recordStop: (sessionId: string) => j<{ recording: boolean; events: TraceEvent[] }>(`${BROWSER}/record/stop`, { method: "POST", body: JSON.stringify({ sessionId }) }),
};
