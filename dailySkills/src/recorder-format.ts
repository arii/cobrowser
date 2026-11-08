// The stored shape of the cobrowser extension recorder (apps/extension/recorder.js).
// chrome.storage.local key: "fixtureRecording". The monitor's "Export JSON" writes this object verbatim.
import { randomUUID } from 'node:crypto';

export type RecorderKind = 'click' | 'change' | 'submit' | 'scroll' | 'page-visible' | 'pointer' | 'key';
export type RecorderTag = 'INPUT' | 'SELECT' | 'TEXTAREA' | 'BUTTON' | 'A' | 'FORM' | 'PAGE' | 'OTHER';
export type RecorderKey = 'Tab' | 'Enter' | 'Escape' | 'Backspace' | 'Delete' | 'ArrowUp' | 'ArrowDown' | 'ArrowLeft' | 'ArrowRight';
export const RECORDER_KINDS: RecorderKind[] = ['click', 'change', 'submit', 'scroll', 'page-visible', 'pointer', 'key'];
export const RECORDER_TAGS: RecorderTag[] = ['INPUT', 'SELECT', 'TEXTAREA', 'BUTTON', 'A', 'FORM', 'PAGE', 'OTHER'];
export const RECORDER_KEYS: RecorderKey[] = ['Tab', 'Enter', 'Escape', 'Backspace', 'Delete', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'];

/** Semantic replay target. Only emitted when a control label is actually known. */
export interface RecorderTarget { tag: 'INPUT' | 'SELECT' | 'TEXTAREA' | 'BUTTON' | 'A'; label: string; type: string }

export interface RecorderEvent {
  id: string;
  sessionId: string;
  at: string;            // ISO timestamp
  origin: string;        // http(s) origin of the page
  tabId: number;
  provenance: 'human';
  kind: RecorderKind;
  tag: RecorderTag;
  x?: number;            // 0..1 viewport fraction (pointer, click)
  y?: number;
  key?: RecorderKey;     // key events only
  target?: RecorderTarget;
  effect?: 'content-changed'; // click followed by a visible page change
}

export interface RecorderTab {
  tabId: number; origin: string; title: string; headings: string[]; excerpt: string;
  active: boolean; observedAt: string; readStatus: 'unavailable' | 'ready' | 'empty';
}

export interface RecorderState {
  schemaVersion: 1;
  sessionId: string;
  startedAt: string;
  events: RecorderEvent[];
  tabs: RecorderTab[];
  tabCount: number;
  dropped: number;
  /** Extra, ignored by the extension: where this recording came from. */
  source?: unknown;
}

/** An event before it is placed on a timeline: time is relative to the task start. */
export interface StagedEvent {
  offsetMs: number;
  kind: RecorderKind;
  tag: RecorderTag;
  x?: number; y?: number;
  key?: RecorderKey;
  target?: RecorderTarget;
  effect?: 'content-changed';
}

export interface StagedTask {
  origin: string;
  title: string;
  originalStart: string | null; // ISO, when the dataset gives one
  durationMs: number;
  events: StagedEvent[];
  source: Record<string, unknown>;
  stats: Record<string, number>;
}

export interface AssembleOptions {
  rebase: 'now' | 'keep';  // 'now' places the recording inside the recorder's 24h retention window
  gapMs: number;           // idle gap between merged tasks
  now?: number;
}

const clamp01 = (value: number) => Math.min(1, Math.max(0, Number(value.toFixed(4))));

export function stagedEvent(input: StagedEvent): StagedEvent {
  const event: StagedEvent = { offsetMs: Math.max(0, Math.round(input.offsetMs)), kind: input.kind, tag: input.tag };
  if (input.x !== undefined && input.y !== undefined) { event.x = clamp01(input.x); event.y = clamp01(input.y); }
  if (input.key) event.key = input.key;
  if (input.target) event.target = input.target;
  if (input.effect) event.effect = input.effect;
  return event;
}

function place(task: StagedTask, sessionId: string, tabId: number, baseMs: number): RecorderEvent[] {
  return task.events.map(event => {
    const placed: RecorderEvent = {
      id: randomUUID(), sessionId, at: new Date(baseMs + event.offsetMs).toISOString(), origin: task.origin, tabId,
      provenance: 'human', kind: event.kind, tag: event.tag,
    };
    if (event.x !== undefined) { placed.x = event.x; placed.y = event.y; }
    if (event.key) placed.key = event.key;
    if (event.target) placed.target = event.target;
    if (event.effect) placed.effect = event.effect;
    return placed;
  });
}

function tabFor(task: StagedTask, tabId: number, active: boolean, observedAtMs: number): RecorderTab {
  return { tabId, origin: task.origin, title: task.title.slice(0, 160), headings: [], excerpt: '', active, observedAt: new Date(observedAtMs).toISOString(), readStatus: 'unavailable' };
}

/** One recording per task. */
export function assembleEach(tasks: StagedTask[], options: AssembleOptions): RecorderState[] {
  const now = options.now ?? Date.now();
  return tasks.map(task => {
    const sessionId = randomUUID();
    const base = options.rebase === 'keep' && task.originalStart ? Date.parse(task.originalStart) : now - 60_000 - task.durationMs;
    const events = place(task, sessionId, 1, base);
    return { schemaVersion: 1, sessionId, startedAt: new Date(base).toISOString(), events, tabs: [tabFor(task, 1, true, base + task.durationMs)], tabCount: 1, dropped: 0, source: task.source };
  });
}

/** All tasks as one session, one tab per task, laid out back to back like a day of browsing. */
export function assembleMerged(tasks: StagedTask[], options: AssembleOptions): RecorderState {
  const now = options.now ?? Date.now();
  const sessionId = randomUUID();
  const total = tasks.reduce((sum, task) => sum + task.durationMs, 0) + options.gapMs * Math.max(0, tasks.length - 1);
  let cursor = options.rebase === 'keep' && tasks[0]?.originalStart ? Date.parse(tasks[0].originalStart) : now - 60_000 - total;
  const startedAt = new Date(cursor).toISOString();
  const events: RecorderEvent[] = []; const tabs: RecorderTab[] = [];
  tasks.forEach((task, index) => {
    const base = options.rebase === 'keep' && task.originalStart ? Date.parse(task.originalStart) : cursor;
    events.push(...place(task, sessionId, index + 1, base));
    tabs.push(tabFor(task, index + 1, index === tasks.length - 1, base + task.durationMs));
    cursor = base + task.durationMs + options.gapMs;
  });
  events.sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  return { schemaVersion: 1, sessionId, startedAt, events, tabs, tabCount: tabs.length, dropped: 0, source: { merged: tasks.map(task => task.source) } };
}

/** Site name -> real origin, used when a task text does not spell out the URL. */
export const SITE_ORIGINS: Record<string, string> = {
  amazon: 'https://www.amazon.com', youtube: 'https://www.youtube.com', 'google search': 'https://www.google.com', google: 'https://www.google.com',
  'search engine': 'https://www.google.com', 'google maps': 'https://www.google.com', 'google news': 'https://news.google.com', 'google translate': 'https://translate.google.com',
  bing: 'https://www.bing.com', wikipedia: 'https://en.wikipedia.org', arxiv: 'https://arxiv.org', reddit: 'https://www.reddit.com', imdb: 'https://www.imdb.com',
  netflix: 'https://www.netflix.com', 'twitter/x': 'https://x.com', x: 'https://x.com', twitter: 'https://x.com', allrecipes: 'https://www.allrecipes.com',
  booking: 'https://www.booking.com', 'bbc news': 'https://www.bbc.com', bbc: 'https://www.bbc.com', coursera: 'https://www.coursera.org', airbnb: 'https://www.airbnb.com',
  'home depot': 'https://www.homedepot.com', quora: 'https://www.quora.com', facebook: 'https://www.facebook.com', linkedin: 'https://www.linkedin.com',
  foxnews: 'https://www.foxnews.com', 'fox news': 'https://www.foxnews.com', 'wolfram alpha': 'https://www.wolframalpha.com', alltrails: 'https://www.alltrails.com',
  buzzfeed: 'https://www.buzzfeed.com', discord: 'https://discord.com', github: 'https://github.com', pinterest: 'https://www.pinterest.com', deepl: 'https://www.deepl.com',
  whatsapp: 'https://web.whatsapp.com', weather: 'https://weather.com', apple: 'https://www.apple.com', ebay: 'https://www.ebay.com', walmart: 'https://www.walmart.com',
  'stack overflow': 'https://stackoverflow.com', stackoverflow: 'https://stackoverflow.com', espn: 'https://www.espn.com', 'cnn': 'https://www.cnn.com', 'nytimes': 'https://www.nytimes.com',
  yelp: 'https://www.yelp.com', tripadvisor: 'https://www.tripadvisor.com', expedia: 'https://www.expedia.com', instagram: 'https://www.instagram.com', tiktok: 'https://www.tiktok.com',
  'google sheets': 'https://docs.google.com', 'google docs': 'https://docs.google.com', 'google slides': 'https://docs.google.com', 'google forms': 'https://docs.google.com',
  'google drive': 'https://drive.google.com', 'google calendar': 'https://calendar.google.com', gmail: 'https://mail.google.com', 'google scholar': 'https://scholar.google.com',
  'google flights': 'https://www.google.com', 'google photos': 'https://photos.google.com', 'google play': 'https://play.google.com', 'youtube music': 'https://music.youtube.com',
  'united airlines': 'https://www.united.com', skyscanner: 'https://www.skyscanner.com', trip: 'https://www.trip.com', 'trip.com': 'https://www.trip.com', chatgpt: 'https://chatgpt.com',
  baidu: 'https://www.baidu.com', kayak: 'https://www.kayak.com', 'bing maps': 'https://www.bing.com', bilibili: 'https://www.bilibili.com', 'microsoft outlook': 'https://outlook.live.com', outlook: 'https://outlook.live.com',
  'microsoft office': 'https://www.office.com', onedrive: 'https://onedrive.live.com', notion: 'https://www.notion.so', slack: 'https://app.slack.com', zoom: 'https://zoom.us', canva: 'https://www.canva.com',
  'stack exchange': 'https://stackexchange.com', medium: 'https://medium.com', 'hugging face': 'https://huggingface.co', huggingface: 'https://huggingface.co', kaggle: 'https://www.kaggle.com',
  'wps learning': 'https://www.wps.com', squarespace: 'https://www.squarespace.com', 'online retailer': 'https://www.amazon.com', 'email account': 'https://mail.google.com',
  spotify: 'https://open.spotify.com', twitch: 'https://www.twitch.tv', etsy: 'https://www.etsy.com', target: 'https://www.target.com', bestbuy: 'https://www.bestbuy.com', 'best buy': 'https://www.bestbuy.com',
};

const URL_IN_TEXT = /https?:\/\/[^\s"'()\]]+/i;

/** Resolve an http(s) origin: known site map first, then a URL inside free text, then a clearly fake fallback. */
export function resolveOrigin(siteName: string | null | undefined, text: string, fallbackSlug: string): { origin: string; resolvedBy: 'site-map' | 'task-text' | 'fallback' } {
  const key = (siteName ?? '').trim().toLowerCase();
  if (key && SITE_ORIGINS[key]) return { origin: SITE_ORIGINS[key], resolvedBy: 'site-map' };
  const match = URL_IN_TEXT.exec(text);
  if (match) {
    try {
      const url = new URL(match[0].replace(/[.,;:]+$/, ''));
      const host = url.hostname.toLowerCase();
      // Datasets usually write the bare domain ("http://foxnews.com"); real sites serve from www.
      const www = host.split('.').length === 2 && !/^(x|arxiv|github|discord|weather)\.(com|org)$/.test(host) ? `www.${host}` : host;
      return { origin: `https://${www}`, resolvedBy: 'task-text' };
    } catch { /* fall through */ }
  }
  if (key) {
    const bare = key.replace(/[^a-z0-9]+/g, '');
    if (bare) return { origin: `https://www.${bare}.com`, resolvedBy: 'fallback' };
  }
  return { origin: `https://${fallbackSlug.replace(/[^a-z0-9-]+/gi, '-').toLowerCase() || 'unknown'}.invalid`, resolvedBy: 'fallback' };
}
