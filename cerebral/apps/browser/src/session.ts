// One shared browser session per task. The agent and the human drive the same Chromium.
//
// Split of responsibilities:
//   Playwright  owns the real Page and a CDP session: role locators, ARIA snapshots, network log,
//               screencast out, human input in. This is what verification and co-browsing need.
//   Stagehand   (v4, optional) connects to the same Chromium over its CDP URL and provides the
//               natural-language act() fallback when a deterministic anchor misses. Only enabled
//               when a model key is present; without one the worker is pure Playwright.
//
// `control` is the co-browsing lock: when it is "human", /act is refused and the human's input
// (forwarded from the canvas as CDP Input.* events) drives the page instead. Handing control to the
// human waits for the agent action that is running (bounded), so the recorder that starts afterwards
// never captures an agent click as a human step; an action that finishes after the human took over is
// reported as a loss of control, never as a completed step.
import fs from "node:fs";
import path from "node:path";
import { Stagehand, localBrowser, type StagehandBrowser } from "@browserbasehq/stagehand";
import { chromium, type Browser, type CDPSession, type Page } from "playwright";
import { Recorder } from "./recorder.js";
import { NetworkLog, captureSnapshot } from "./snapshot.js";
import type { Action, Snapshot } from "./types.js";

export type Controller = "agent" | "human";

/** act()/actNatural() refused or voided because the human holds control. `raced` means the Playwright
 *  action did run but a human took over before it was reported: the caller must not treat it as done. */
export class HumanHasControl extends Error {
  constructor(public readonly raced = false) {
    super(raced ? "human took control while the action was running" : "human has control");
    this.name = "HumanHasControl";
  }
}

// Read at launch time, not import time, so a late .env load still applies.
const headless = () => process.env.HEADLESS !== "false";
const defaultProfileDir = () => path.resolve(import.meta.dirname, "../../../.browser-profile");

/** Chromium records which process owns a profile in `<dir>/SingletonLock`, a symlink to "<host>-<pid>".
 *  Returns that pid while the process is alive (another worker's Chromium has the profile open); null when
 *  there is no lock or it is stale (Chromium removes a stale lock itself). */
function profileOwnerPid(dir: string): number | null {
  let target: string;
  try {
    target = fs.readlinkSync(path.join(dir, "SingletonLock"));
  } catch {
    return null;
  }
  const pid = Number(/-(\d+)$/.exec(target)?.[1]);
  if (!pid) return null;
  try {
    process.kill(pid, 0);
    return pid;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === "EPERM" ? pid : null;  // EPERM: alive, not ours; ESRCH: gone
  }
}

/** The one error for "two browsers want the same profile", instead of Playwright's launch log. The usual cause
 *  is a second worker process (an older one left running, or a test worker on another port). */
function profileInUseError(dir: string, pid: number | null): Error {
  const holder = pid ? `Chromium pid ${pid}` : "another Chromium";
  return new Error(
    `browser profile ${dir} is already open in ${holder}; a Chromium profile can be used by one browser at a time. ` +
    "Usually a second browser worker is running (lsof -nP -iTCP -sTCP:LISTEN | grep node): stop it, " +
    "or give this worker its own profile with PROFILE_DIR=<dir> (PROFILE_DIR= for a throwaway profile).",
  );
}

let sharedCtx: Promise<import("playwright").BrowserContext> | null = null;
async function sharedPersistentContext(dir: string) {
  if (!sharedCtx) {
    const owner = profileOwnerPid(dir);
    if (owner !== null) throw profileInUseError(dir, owner);
    sharedCtx = chromium.launchPersistentContext(dir, { headless: headless(), viewport: { width: 1280, height: 800 } })
      .then((ctx) => {
        ctx.on("close", () => { sharedCtx = null; });  // user closed the window: relaunch on next session
        return ctx;
      })
      .catch((e) => {
        sharedCtx = null;
        // Chromium found a live instance on this profile between our check and its launch (or the lock
        // is held by a process we could not see): same situation, same readable error.
        if (/Opening in existing browser session/.test(String((e as Error)?.message))) throw profileInUseError(dir, profileOwnerPid(dir));
        throw e;
      });
  }
  return sharedCtx;
}
/** How long setControl("human") waits for the in-flight agent action before taking over regardless. */
const HANDOFF_WAIT_MS = 10_000;

function stagehandModel() {
  const key = process.env.STAGEHAND_MODEL_API_KEY ?? process.env.OPENAI_API_KEY ?? process.env.ANTHROPIC_API_KEY;
  if (!key) return null;
  const modelName = process.env.STAGEHAND_MODEL ?? (process.env.ANTHROPIC_API_KEY && !process.env.OPENAI_API_KEY
    ? "anthropic/claude-sonnet-5-5" : "openai/gpt-4.1-mini");
  return { modelName: modelName as `openai/${string}`, apiKey: key };
}

export class Session {
  id: string;
  control: Controller = "agent";
  net = new NetworkLog();
  page!: Page;
  cdp!: CDPSession;
  recorder!: Recorder; // demonstration capture: DOM-level actions the human performs, as trace events
  private pw: Browser | null = null;  // null until start(); a persistent context may not expose one
  private handle: StagehandBrowser | null = null;
  private stagehand: Stagehand | null = null;
  private screencastListeners = new Set<(frame: { data: string; metadata: unknown }) => void>();
  // Settles when every agent action (act/actNatural) started so far has finished, success or not.
  private inflight: Promise<void> = Promise.resolve();
  private inflightCount = 0;
  private ctx: import("playwright").BrowserContext | null = null;  // persistent-profile context, when used
  private ownsPageOnly = false;  // true when the context is shared: close() closes this page, not the browser  // agent actions not yet settled; the recorder refuses raw events while > 0

  constructor(id: string) {
    this.id = id;
  }

  async start() {
    const model = stagehandModel();
    if (model) {
      // Stagehand launches Chromium and exposes its CDP URL; Playwright attaches to the same browser.
      this.handle = await localBrowser.launch({ headless: headless() });
      this.stagehand = await Stagehand.create({ browser: this.handle, model });
      if (!this.handle.cdpUrl) throw new Error("Stagehand local browser did not expose a CDP URL");
      this.pw = await chromium.connectOverCDP(this.handle.cdpUrl);
      const ctx = this.pw.contexts()[0] ?? (await this.pw.newContext());
      this.page = ctx.pages()[0] ?? (await ctx.newPage());
    } else {
      // One persistent profile for the headed (demo) worker: cookies, a cleared bot check and consent
      // choices survive across sessions and runs. Sessions share it, each in its own page. A headless
      // worker (tests, an ad-hoc worker on another port) gets a throwaway profile per session unless
      // PROFILE_DIR names one, so it can never hold the demo's profile open; PROFILE_DIR= (empty) forces
      // a throwaway profile for a headed worker too.
      const profileDir = process.env.PROFILE_DIR !== undefined ? process.env.PROFILE_DIR : headless() ? "" : defaultProfileDir();
      if (profileDir) {
        // A Chromium profile can be open in one browser at a time, so every session in this worker
        // shares one persistent context and gets its own page (tab/window) in it.
        const ctx = await sharedPersistentContext(profileDir);
        this.pw = null;  // owned by the shared context, never closed per session
        this.ctx = ctx;
        this.page = await ctx.newPage();
        this.ownsPageOnly = true;
      } else {
        this.pw = await chromium.launch({ headless: headless() });
        this.page = await (await this.pw.newContext({ viewport: { width: 1280, height: 800 } })).newPage();
      }
    }
    this.net.attach(this.page);
    this.cdp = await this.page.context().newCDPSession(this.page);
    // One screencast frame handler for the life of the session. Viewers come and go through
    // `screencastListeners`; startScreencast() and its stop function only toggle the screencast itself.
    this.cdp.on("Page.screencastFrame", (f) => {
      for (const l of this.screencastListeners) {
        try { l({ data: f.data, metadata: f.metadata }); } catch { /* one dead viewer must not starve the others */ }
      }
      this.cdp.send("Page.screencastFrameAck", { sessionId: f.sessionId }).catch(() => undefined);
    });
    this.recorder = new Recorder(this.page, () => this.snapshot(), () => this.inflightCount === 0);
    // The page script that computes snapshots (and reports human actions while recording) goes into
    // every document up front, so the first snapshot does not have to inject it on demand.
    await this.recorder.install();
  }

  get hasNaturalLanguageFallback(): boolean {
    return this.stagehand !== null;
  }

  async snapshot(): Promise<Snapshot> {
    return captureSnapshot(this.page, this.net);
  }

  /** Run an agent action and keep `inflight` covering it until it settles. */
  private track<T>(fn: () => Promise<T>): Promise<T> {
    this.inflightCount += 1;
    const p = fn().finally(() => { this.inflightCount -= 1; });
    const prev = this.inflight;
    this.inflight = Promise.all([prev, p.then(() => undefined, () => undefined)]).then(() => undefined);
    return p;
  }

  /** True while any agent action started via act()/actNatural() has not settled. */
  get agentActionInFlight(): boolean {
    return this.inflightCount > 0;
  }

  /** Performs the action; resolves with the snapshot only when it was actually performed while the agent
   *  held control. Throws HumanHasControl (refused up front, or `raced` when a human took over mid-action)
   *  or the Playwright error when the anchor could not be acted on. */
  async act(action: Action): Promise<Snapshot> {
    return this.track(async () => {
      if (this.control !== "agent") throw new HumanHasControl();
      switch (action.kind) {
        case "navigate":
          await this.page.goto(action.value ?? "", { waitUntil: "domcontentloaded" });
          break;
        case "click":
          await this.locate(action.target!).first().click({ timeout: 8000 });
          break;
        case "type":
          await this.locate(action.target!).first().fill(action.value ?? "", { timeout: 8000 });
          break;
        case "select":
          await this.locate(action.target!).first().selectOption(action.value ?? "", { timeout: 8000 });
          break;
        case "press":
          await this.page.keyboard.press(action.value ?? "Enter");
          break;
        case "wait":
          await this.page.waitForTimeout(Number(action.value ?? 1000));
          break;
        case "noop":
          break;
      }
      await this.page.waitForLoadState("networkidle", { timeout: 5000 }).catch(() => undefined);
      // A human may have taken over while the action ran (the handoff waits at most HANDOFF_WAIT_MS).
      // Their take-over wins: report the race instead of a completed step.
      if (this.control !== "agent") throw new HumanHasControl(true);
      return this.snapshot();
    });
  }

  // Anchor "role=button name=Add to cart" -> Playwright role locator. Deterministic, replayable.
  private locate(anchor: string) {
    const role = /role=(\w+)/.exec(anchor)?.[1];
    const name = /name=(.+?)(?:\s\w+=|$)/.exec(anchor)?.[1]?.trim();
    if (role) return this.page.getByRole(role as Parameters<Page["getByRole"]>[0], name ? { name, exact: false } : undefined);
    return this.page.getByText(name ?? anchor);
  }

  // Natural-language fallback. The receipt records that the anchor was dropped (action.target=null).
  // Same contract as act(): snapshot only on success, HumanHasControl when refused or raced.
  async actNatural(instruction: string): Promise<Snapshot> {
    return this.track(async () => {
      if (this.control !== "agent") throw new HumanHasControl();
      if (!this.stagehand) throw new Error("no Stagehand model configured; set STAGEHAND_MODEL_API_KEY");
      await this.stagehand.act(instruction);
      await this.page.waitForLoadState("networkidle", { timeout: 5000 }).catch(() => undefined);
      if (this.control !== "agent") throw new HumanHasControl(true);
      return this.snapshot();
    });
  }

  /** Flip the co-browsing lock. Handing to the human first waits (bounded by HANDOFF_WAIT_MS) for the
   *  agent action in flight, so whatever the caller starts next (the recorder) sees a quiet page. */
  async setControl(who: Controller): Promise<void> {
    if (who === "human" && this.control === "agent") await this.awaitInflight(HANDOFF_WAIT_MS);
    this.control = who;
  }

  private async awaitInflight(ms: number): Promise<void> {
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<void>((resolve) => { timer = setTimeout(resolve, ms); });
    try {
      await Promise.race([this.inflight, timeout]);
    } finally {
      clearTimeout(timer);
    }
  }

  // ---- co-browsing: screencast out, input in ----
  /** Subscribe a viewer to frames. The first viewer starts the screencast, the last one's stop function
   *  stops it; the CDP frame handler itself is registered once in start(). */
  async startScreencast(onFrame: (f: { data: string; metadata: unknown }) => void): Promise<() => void> {
    this.screencastListeners.add(onFrame);
    if (this.screencastListeners.size === 1) {
      try {
        // everyNthFrame must be 1: a static page paints once after load, and skipping every other
        // frame would leave a new viewer with nothing. The nudge below forces one repaint so the
        // first frame arrives immediately instead of on the next page change.
        await this.cdp.send("Page.startScreencast", { format: "jpeg", quality: 60, maxWidth: 1280, maxHeight: 800, everyNthFrame: 1 });
      } catch (e) {
        this.screencastListeners.delete(onFrame);
        throw e;
      }
    }
    // Every new viewer gets a frame at once, even when the screencast was already running for
    // another viewer (React dev mode connects twice; the second socket must not wait for a page change).
    await this.nudgeRepaint();
    let stopped = false;
    return () => {
      if (stopped) return;
      stopped = true;
      this.screencastListeners.delete(onFrame);
      if (this.screencastListeners.size === 0) this.cdp.send("Page.stopScreencast").catch(() => undefined);
    };
  }

  /** Force a compositor frame so the screencast emits a frame for a page that is otherwise static. */
  private async nudgeRepaint(): Promise<void> {
    await this.page.evaluate(() => new Promise<void>((done) => {
      const el = document.documentElement;
      const prev = el.style.opacity;
      el.style.opacity = "0.999";
      requestAnimationFrame(() => { el.style.opacity = prev; requestAnimationFrame(() => done()); });
    })).catch(() => undefined);
  }

  async humanInput(ev: { type: string; params?: Record<string, unknown> }) {
    if (this.control !== "human") throw new Error("agent has control");
    if (ev.type === "mouse") await this.cdp.send("Input.dispatchMouseEvent", ev.params as never);
    if (ev.type === "key") await this.cdp.send("Input.dispatchKeyEvent", ev.params as never);
  }

  async close() {
    await this.stagehand?.close().catch(() => undefined);
    if (this.ownsPageOnly) {
      await this.page?.close().catch(() => undefined);
      return;
    }
    await this.ctx?.close().catch(() => undefined);
    await this.pw?.close().catch(() => undefined);
    await this.handle?.close().catch(() => undefined);
  }
}
