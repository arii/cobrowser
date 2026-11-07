// Demonstration recorder for the worker: the shared page script reports DOM-level events through a
// Playwright binding, and the shared TraceCoalescer turns them into (before, action, after) trace
// events. This file only wires Playwright to those two pieces (see packages/page-capture).
//
// Nothing here uses a model. Pixel input (the CDP mouse/key relay in session.ts) stays as it is:
// this listens to what that input *did* in the DOM, which is the only thing worth learning.
import type { Page } from "playwright";
import { TraceCoalescer } from "../../../packages/page-capture/src/coalescer.js";
import { RECORD_BINDING, pageCaptureInstaller } from "../../../packages/page-capture/src/page.js";
import type { RawEvent } from "../../../packages/page-capture/src/types.js";
import type { Action, Snapshot } from "./types.js";

export type TraceEvent = { before: Snapshot; action: Action; after: Snapshot };

const SETTLE_MS = 4000; // max wait for network idle after an action before snapshotting

export class Recorder {
  private co: TraceCoalescer;
  private installed = false;

  /**
   * @param admit  Gate on raw DOM events. The session passes a predicate that is false while an agent
   *               action is still in flight, so a late-landing agent click (notably a slow Stagehand
   *               act()) is never committed to the human's trace after a takeover. Finding #30.
   */
  constructor(private page: Page, snapshot: () => Promise<Snapshot>, private admit: () => boolean = () => true) {
    this.co = new TraceCoalescer({
      snapshot,
      settle: async () => {
        // A click that navigates has not committed the navigation yet when the binding fires; give it a
        // beat, then wait for the network to go quiet.
        await page.waitForTimeout(250);
        await page.waitForLoadState("domcontentloaded", { timeout: SETTLE_MS }).catch(() => undefined);
        await page.waitForLoadState("networkidle", { timeout: SETTLE_MS }).catch(() => undefined);
      },
    });
  }

  get active() { return this.co.active; }
  get events(): TraceEvent[] { return this.co.events; }

  onEvent(fn: (ev: TraceEvent, index: number) => void) {
    return this.co.onEvent(fn);
  }

  /** Expose the binding and install the page script in every document (and the one already open). */
  async install() {
    if (this.installed) return;
    this.installed = true;
    await this.page.exposeBinding(RECORD_BINDING, (_src, raw: RawEvent) => {
      if (!this.admit()) return;  // an agent action is still running; this event is not the human's
      this.co.raw(raw);
    });
    await this.page.addInitScript(pageCaptureInstaller());
    await this.page.evaluate(pageCaptureInstaller()).catch(() => undefined);
  }

  /** Begin a demonstration. `before` of the first event is the page as it is right now. */
  async start() {
    await this.install();
    await this.co.start();
  }

  /** Flush any half-typed field, wait for in-flight events, return everything recorded. */
  async stop(): Promise<TraceEvent[]> {
    return this.co.stop();
  }

  /** Record an action the worker performs for the human (e.g. the opening navigate) as a trace event. */
  async perform(action: Action, run: () => Promise<void>) {
    await this.install();
    await this.co.perform(action, run);
  }
}
