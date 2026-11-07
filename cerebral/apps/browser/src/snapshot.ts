// Normalized page state. The Python side hashes (url path, sorted (role, name) pairs), so what
// matters here is a stable, de-noised accessibility tree, not pixels or raw HTML.
//
// The tree and text come from the shared page script (packages/page-capture), the same code the
// Chrome extension runs while a human demonstrates. Using Playwright's own ARIA snapshot here would
// make demonstration and replay hash differently and every derived precondition would fail.
import type { Page } from "playwright";
import { pageCaptureInstaller } from "../../../packages/page-capture/src/page.js";
import type { PageSnapshot } from "../../../packages/page-capture/src/types.js";
import type { NetworkEvent, Snapshot } from "./types.js";

export class NetworkLog {
  events: NetworkEvent[] = [];
  attach(page: Page) {
    page.on("response", (r) => {
      const url = r.url();
      if (/\.(png|jpg|jpeg|gif|svg|woff2?|css|js|ico)(\?|$)/i.test(url)) return;
      this.events.push({ method: r.request().method(), url, status: r.status() });
      if (this.events.length > 200) this.events.shift();
    });
  }
  drain(): NetworkEvent[] {
    const out = this.events;
    this.events = [];
    return out;
  }
}

const readPage = () => {
  const api = (window as unknown as { __cerebralPage?: { snapshot(): PageSnapshot } }).__cerebralPage;
  return api ? api.snapshot() : null;
};

const NO_CAPTURE = { scanned: 0, emitted: 0, hidden: 0, boxless: 0, truncated: false };

/** Tree + text + url + title as the page script computes them; installs the script if this document lacks it.
 *  `capture.source` says how the snapshot was obtained: "init" (the script installed at document start answered),
 *  "injected" (it was missing and had to be evaluated into the page first) or "missing" (even that failed: the page
 *  is navigating, or a CSP/frame refused the script, and the tree is empty for that reason, not because of the page). */
export async function pageSnapshot(page: Page): Promise<PageSnapshot> {
  let s = await page.evaluate(readPage).catch(() => null);
  let source = "init";
  if (!s) {
    source = "injected";
    await page.evaluate(pageCaptureInstaller()).catch(() => undefined);
    s = await page.evaluate(readPage).catch(() => null);
  }
  if (!s) {
    // Both evaluations failed: the usual cause is a navigation in flight (the execution context was destroyed
    // between the action and the snapshot). Let the new document arrive and ask it once more before reporting
    // an empty tree, which every element_visible check would then fail on.
    source = "retried";
    await page.waitForLoadState("domcontentloaded", { timeout: 3000 }).catch(() => undefined);
    s = await page.evaluate(readPage).catch(() => null);
  }
  if (!s) {
    return { url: page.url(), title: await page.title().catch(() => ""), tree: [], text: "", capture: { ...NO_CAPTURE, source: "missing" } };
  }
  return { ...s, capture: { ...(s.capture ?? NO_CAPTURE), source } };
}

export async function captureSnapshot(page: Page, net: NetworkLog, screenshotDir?: string): Promise<Snapshot> {
  const base = await pageSnapshot(page);
  let screenshot_ref: string | null = null;
  if (screenshotDir) {
    const file = `${screenshotDir}/${Date.now()}.png`;
    await page.screenshot({ path: file, fullPage: false }).catch(() => undefined);
    screenshot_ref = file;
  }
  return { ...base, network: net.drain(), screenshot_ref, captured_at: new Date().toISOString() };
}
