// Host-agnostic half of demonstration capture: turns the page script's raw events into typed
// (before, action, after) trace events, the shape apps/api/cerebral/derive.py consumes.
//
// The host supplies two things: how to snapshot the page and how to wait for it to settle after an
// action. The browser worker does both with Playwright; the extension's service worker asks its
// content script and watches webRequest. Everything else (keystroke coalescing, ordering, the
// before/after chain) lives here so both hosts record identical traces for identical behaviour.
import type { Action, RawEvent, Snapshot, TraceEvent } from "./types.js";

export type CoalescerHost = {
  snapshot(): Promise<Snapshot>;
  /** Resolve once the page has quieted down after an action (bounded; never reject). */
  settle(): Promise<void>;
};

export type PendingType = { target: string; value: string; description: string };

/** Everything needed to resume a recording in a fresh process (the extension's service worker can be killed mid-demo). */
export type CoalescerState = { before: Snapshot | null; pendingType: PendingType | null; count: number };

export const anchor = (role: string, name: string) => (name ? `role=${role} name=${name}` : `role=${role}`);

export const TYPE_IDLE_MS = 900; // keystrokes this far apart on the same field still count as one `type`

export class TraceCoalescer {
  active = false;
  events: TraceEvent[] = [];
  private before: Snapshot | null = null;
  private pendingType: PendingType | null = null;
  private typeTimer: ReturnType<typeof setTimeout> | null = null;
  private chain: Promise<void> = Promise.resolve(); // raw events are handled strictly in order
  private listeners = new Set<(ev: TraceEvent, index: number) => void>();
  private count = 0;
  // Last committed value per field. A `type` whose value is "" on a field that was already empty is
  // not a step (it is the site clearing or re-rendering the field when it gains focus) and is dropped.
  private lastValue = new Map<string, string>();

  constructor(private host: CoalescerHost, private typeIdleMs: number = TYPE_IDLE_MS) {}

  onEvent(fn: (ev: TraceEvent, index: number) => void) {
    this.listeners.add(fn);
    return () => { this.listeners.delete(fn); };
  }

  /** Begin a demonstration. `before` of the first event is the page as it is right now (or as given). */
  async start(before?: Snapshot) {
    this.events = [];
    this.count = 0;
    this.pendingType = null;
    this.lastValue.clear();
    this.before = before ?? (await this.snapshotWithRetry());
    this.active = true;
  }

  /** Flush any half-typed field, wait for in-flight events, return everything recorded by this instance. */
  async stop(): Promise<TraceEvent[]> {
    this.active = false;
    this.chain = this.chain.then(() => this.flushType()).catch(() => undefined);
    await this.chain;
    return this.events;
  }

  /** Record an action the host performs for the human (e.g. an opening navigate) as a trace event. */
  async perform(action: Action, run: () => Promise<void>) {
    if (!this.active) await this.start();
    this.chain = this.chain.then(async () => {
      await this.flushType();
      await run();
      await this.commit(action);
    }).catch(() => undefined);
    await this.chain;
  }

  /** Feed one raw event from the page script. Ignored unless recording. */
  raw(ev: RawEvent) {
    if (!this.active) return;
    this.chain = this.chain.then(() => this.handle(ev)).catch(() => undefined);
  }

  /** Wait for everything queued so far to be processed. */
  async idle() { await this.chain; }

  exportState(): CoalescerState {
    return { before: this.before, pendingType: this.pendingType, count: this.count };
  }

  /** Resume from a persisted state; the instance becomes active without snapshotting. */
  importState(s: CoalescerState) {
    this.before = s.before;
    this.pendingType = s.pendingType;
    this.count = s.count;
    this.active = true;
    if (this.pendingType) this.armTypeTimer();
  }

  private async handle(raw: RawEvent) {
    switch (raw.type) {
      case "input": {
        const target = anchor(raw.role, raw.name);
        if (this.pendingType && this.pendingType.target !== target) await this.flushType();
        this.pendingType = {
          target, value: raw.value,
          description: raw.secret
            ? `type into ${raw.name || "password field"} (value redacted)`
            : `type ${JSON.stringify(raw.value)} into ${raw.name || raw.role}`,
        };
        this.armTypeTimer();
        return;
      }
      case "click":
        await this.flushType();
        return this.commit({ kind: "click", target: anchor(raw.role, raw.name), description: `click ${raw.name || raw.role}` });
      case "select":
        await this.flushType();
        return this.commit({ kind: "select", target: anchor("combobox", raw.name), value: raw.value, description: `select ${raw.value}` });
      case "key":
        await this.flushType();
        return this.commit({ kind: "press", value: raw.key, description: `press ${raw.key}` });
    }
  }

  private armTypeTimer() {
    if (this.typeTimer) clearTimeout(this.typeTimer);
    this.typeTimer = setTimeout(() => {
      this.chain = this.chain.then(() => this.flushType()).catch(() => undefined);
    }, this.typeIdleMs);
  }

  private async flushType() {
    if (this.typeTimer) { clearTimeout(this.typeTimer); this.typeTimer = null; }
    const p = this.pendingType;
    if (!p) return;
    this.pendingType = null;
    if (p.value === "" && (this.lastValue.get(p.target) ?? "") === "") return; // nothing was typed
    this.lastValue.set(p.target, p.value);
    await this.commit({ kind: "type", target: p.target, value: p.value, description: p.description });
  }

  private async snapshotWithRetry(): Promise<Snapshot> {
    try { return await this.host.snapshot(); }
    catch { await new Promise((r) => setTimeout(r, 500)); return this.host.snapshot(); }
  }

  private async commit(action: Action) {
    await this.host.settle();
    const after = await this.snapshotWithRetry();
    const ev: TraceEvent = { before: this.before ?? after, action, after };
    this.before = after;
    this.events.push(ev);
    const index = this.count++;
    for (const l of this.listeners) l(ev, index);
  }
}
