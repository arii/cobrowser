// Service worker: the extension's host half of demonstration capture.
//
//   toolbar button  → start: POST /demos/start, inject the content script into the active tab, begin
//                     coalescing. Badge shows REC.
//   toolbar button  → stop: flush, open finish.html where the human names the skill and states its goal,
//                     then POST /demos/{id}/finish. The API derives the skill; the web app shows it.
//
// The TraceCoalescer (shared with the browser worker) turns raw DOM events from the content script into
// (before, action, after) trace events. This file gives it a snapshot() (ask the content script, add
// the webRequest log) and a settle() (tab finished loading and the network has been quiet).
//
// MV3 service workers are killed after ~30s idle, so the recording state (including the coalescer's
// pending `before` snapshot) is persisted to chrome.storage.session after every change and reloaded on
// wake. Events already sent to the API are not kept here, only their actions, for the finish page.
import { TraceCoalescer, type CoalescerState } from "../../../packages/page-capture/src/coalescer.js";
import type { Action, NetworkEvent, PageSnapshot, RawEvent, Snapshot, TraceEvent } from "../../../packages/page-capture/src/types.js";

import { getSettings as settings } from "./settings.js";
export type { Settings } from "./settings.js";

export type Recording = {
  demoId: string;
  tabId: number;
  site: string;
  startedAt: string;
  phase: "recording" | "finishing";
  actions: Action[];
  coalescer: CoalescerState;
  error?: string;
};

export type Skill = { id: string; name: string; goal: string; site: string; steps: { name: string }[] };

const SETTLE_MS = 4000;
const NET_QUIET_MS = 400;
const ASSET = /\.(png|jpg|jpeg|gif|svg|woff2?|css|js|ico)(\?|$)/i;

let rec: Recording | null = null;
let co: TraceCoalescer | null = null;
let net: NetworkEvent[] = [];
let lastNetAt = 0;
let sendChain: Promise<void> = Promise.resolve(); // events reach the API in the order they happened

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function postJson<T>(url: string, body: unknown): Promise<T> {
  const r = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  if (!r.ok) throw new Error(`${url} → ${r.status} ${await r.text().catch(() => "")}`);
  return r.json() as Promise<T>;
}

// ---- persistence ----

async function persist() {
  if (!rec) { await chrome.storage.session.remove("rec"); return; }
  if (co) rec.coalescer = co.exportState();
  await chrome.storage.session.set({ rec });
}

const loaded: Promise<void> = (async () => {
  const { rec: saved } = (await chrome.storage.session.get("rec")) as { rec?: Recording };
  if (saved) {
    rec = saved;
    if (rec.phase === "recording") { co = makeCoalescer(); co.importState(rec.coalescer); }
  }
  await badge();
})();

async function badge() {
  const text = !rec ? "" : rec.error ? "ERR" : rec.phase === "recording" ? "REC" : "…";
  const color = rec?.error ? "#b00020" : rec?.phase === "recording" ? "#d93025" : "#5b8def";
  const title = !rec ? "Cerebral: start demonstrating"
    : rec.error ? `Cerebral: ${rec.error}`
    : rec.phase === "recording" ? `Cerebral: recording ${rec.actions.length} step(s). Click to finish.`
    : "Cerebral: finish the demonstration";
  await chrome.action.setBadgeText({ text });
  await chrome.action.setBadgeBackgroundColor({ color });
  await chrome.action.setTitle({ title });
}

// ---- page access ----

async function inject(tabId: number) {
  await chrome.scripting.executeScript({ target: { tabId }, files: ["content.js"], injectImmediately: true }).catch(() => undefined);
}

async function askPage(tabId: number): Promise<PageSnapshot | null> {
  for (let i = 0; i < 6; i++) {
    try {
      const s = (await chrome.tabs.sendMessage(tabId, { type: "snapshot" })) as PageSnapshot | null;
      if (s) return s;
    } catch { /* no receiver yet: document is mid-navigation or the script is not there */ }
    await sleep(250);
    await inject(tabId);
  }
  return null;
}

function drainNet(): NetworkEvent[] { const out = net; net = []; return out; }

function makeCoalescer(): TraceCoalescer {
  const c = new TraceCoalescer({
    snapshot: async (): Promise<Snapshot> => {
      const tabId = rec!.tabId;
      const tab = await chrome.tabs.get(tabId);
      const page = (await askPage(tabId)) ?? { url: tab.url ?? "", title: tab.title ?? "", tree: [], text: "" };
      return { ...page, url: page.url || tab.url || "", network: drainNet(), screenshot_ref: null, captured_at: new Date().toISOString() };
    },
    settle: async () => {
      // A click that navigates has not committed yet when the raw event arrives; give it a beat, then
      // wait for the tab to finish loading and the network to go quiet (bounded).
      await sleep(250);
      const deadline = Date.now() + SETTLE_MS;
      while (Date.now() < deadline) {
        const tab = await chrome.tabs.get(rec!.tabId).catch(() => null);
        if (!tab) return;
        if (tab.status === "complete" && Date.now() - lastNetAt > NET_QUIET_MS) return;
        await sleep(100);
      }
    },
  });
  c.onEvent((ev: TraceEvent) => {
    if (!rec) return;
    rec.actions.push(ev.action);
    void persist();
    void badge();
    const demoId = rec.demoId;
    sendChain = sendChain.then(async () => {
      const s = await settings();
      await postJson(`${s.apiUrl}/demos/${demoId}/events`, ev);
    }).catch(async (e) => {
      console.warn("could not forward trace event", e);
      if (rec && rec.demoId === demoId) { rec.error = "API unreachable; events are being lost"; await persist(); await badge(); }
    });
  });
  return c;
}

// ---- start / stop / finish ----

async function start(tab: chrome.tabs.Tab) {
  if (!tab.id || !tab.url || !/^https?:/.test(tab.url)) throw new Error("open an http(s) page first");
  const s = await settings();
  const host = new URL(tab.url).hostname;
  const demo = await postJson<{ id: string }>(`${s.apiUrl}/demos/start`, { name: `${host} demonstration`, goal: "", site: tab.url });
  rec = { demoId: demo.id, tabId: tab.id, site: tab.url, startedAt: new Date().toISOString(), phase: "recording", actions: [],
          coalescer: { before: null, pendingType: null, count: 0 } };
  net = []; lastNetAt = 0;
  await inject(tab.id);
  co = makeCoalescer();
  await co.start();
  await persist();
  await badge();
}

async function stop() {
  if (!rec || rec.phase !== "recording") return;
  if (co) { await co.stop(); co = null; }
  await sendChain;
  rec.phase = "finishing";
  await persist();
  await badge();
  await openFinishPage();
}

async function openFinishPage() {
  const url = chrome.runtime.getURL("finish.html");
  const existing = await chrome.tabs.query({ url });
  if (existing[0]?.id) { await chrome.tabs.update(existing[0].id, { active: true }); return; }
  await chrome.tabs.create({ url });
}

async function finish(name: string, goal: string): Promise<Skill> {
  if (!rec) throw new Error("nothing to finish");
  const s = await settings();
  const skill = await postJson<Skill>(`${s.apiUrl}/demos/${rec.demoId}/finish`, { name: name || undefined, goal: goal || undefined });
  rec = null; co = null;
  await persist();
  await badge();
  return skill;
}

async function discard() {
  if (co) { co.stop().catch(() => undefined); co = null; }
  rec = null;
  await persist();
  await badge();
}

// ---- wiring ----

chrome.action.onClicked.addListener(async (tab) => {
  await loaded;
  try {
    if (!rec) await start(tab);
    else if (rec.phase === "recording") await stop();
    else await openFinishPage();
  } catch (e) {
    console.error(e);
    rec = { demoId: "", tabId: tab.id ?? -1, site: tab.url ?? "", startedAt: new Date().toISOString(), phase: "finishing", actions: [],
            coalescer: { before: null, pendingType: null, count: 0 }, error: (e as Error).message };
    await badge();
    rec = null; // nothing was recorded; leave the error on the badge until the next click
  }
});

chrome.runtime.onMessage.addListener((msg: { type: string; ev?: RawEvent; name?: string; goal?: string }, sender, reply) => {
  if (msg.type === "raw") {
    void loaded.then(() => { if (rec && rec.phase === "recording" && sender.tab?.id === rec.tabId && co) co.raw(msg.ev!); });
    return false;
  }
  const respond = async () => {
    await loaded;
    switch (msg.type) {
      case "state": return { rec, settings: await settings() };
      case "finish": return { skill: await finish(msg.name ?? "", msg.goal ?? "") };
      case "discard": await discard(); return { ok: true };
      case "stop": await stop(); return { ok: true };
    }
    return { error: `unknown message ${msg.type}` };
  };
  respond().then(reply, (e) => reply({ error: (e as Error).message }));
  return true;
});

// Keep the sensor in the recorded tab across navigations.
chrome.webNavigation.onCommitted.addListener(async (d) => {
  await loaded;
  if (rec && rec.phase === "recording" && d.tabId === rec.tabId && d.frameId === 0) await inject(d.tabId);
});
chrome.tabs.onUpdated.addListener(async (tabId, info) => {
  await loaded;
  if (rec && rec.phase === "recording" && tabId === rec.tabId && info.status === "complete") await inject(tabId);
});
chrome.tabs.onRemoved.addListener(async (tabId) => {
  await loaded;
  if (rec && rec.phase === "recording" && tabId === rec.tabId) await stop();
});

// Network log for the recorded tab: feeds Snapshot.network (the network_ok assertion) and settle().
chrome.webRequest.onBeforeRequest.addListener((d) => {
  if (rec && d.tabId === rec.tabId) lastNetAt = Date.now();
}, { urls: ["<all_urls>"] });
chrome.webRequest.onCompleted.addListener((d) => {
  if (!rec || d.tabId !== rec.tabId) return;
  lastNetAt = Date.now();
  if (ASSET.test(d.url)) return;
  net.push({ method: d.method, url: d.url, status: d.statusCode });
  if (net.length > 200) net.shift();
}, { urls: ["<all_urls>"] });

// Test hook (Playwright drives the service worker directly; there is no way to click the toolbar button).
(globalThis as unknown as { cerebral: unknown }).cerebral = {
  start: async (tabId: number) => { await loaded; await start(await chrome.tabs.get(tabId)); },
  stop: async () => { await loaded; await stop(); },
  finish: async (name: string, goal: string) => { await loaded; return finish(name, goal); },
  state: async () => { await loaded; return rec; },
  idle: async () => { await co?.idle(); await sendChain; },
};
