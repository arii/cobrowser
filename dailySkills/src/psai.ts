// anaisleila/computer-use-data-psai -> recorder format.
// Rows come from the Hugging Face datasets-server rows/filter API; no parquet download needed.
import { resolveOrigin, stagedEvent, type RecorderKey, type StagedEvent, type StagedTask } from './recorder-format.js';

export interface PsaiRow {
  unique_data_id: string; taskId: string; task_name: string; category: string; subCategory: string[];
  application_website: string; tags: string[]; difficulty: string; os: string; requires_login: string;
  reasoning_steps: unknown[]; metadata: string; screenshots: { src: string }[]; video_file: string; dom_snaps_file: string; events: string;
}
interface RawEvent {
  time_stamp: number; action: string; x?: number | null; y?: number | null; dx?: number; dy?: number; button?: string | null; pressed?: boolean | null;
  name?: string; app_name?: string; window_title?: string; state?: string;
}

const API = 'https://datasets-server.huggingface.co';
const DATASET = 'anaisleila/computer-use-data-psai';

/** One page of rows (max 100) from the datasets-server. The /filter endpoint currently returns HTTP 500 for this
 *  dataset, so site filtering is done client-side by the caller while paging through /rows. */
export async function fetchPsaiRows(options: { offset: number; length: number }): Promise<{ rows: PsaiRow[]; total: number }> {
  const params = new URLSearchParams({ dataset: DATASET, config: 'default', split: 'train', offset: String(options.offset), length: String(Math.min(100, options.length)) });
  const response = await fetch(`${API}/rows?${params}`, { signal: AbortSignal.timeout(180_000) });
  if (!response.ok) throw new Error(`datasets-server rows returned HTTP ${response.status}`);
  const body = await response.json() as { rows: { row: PsaiRow }[]; num_rows_total: number; error?: string };
  if (body.error) throw new Error(`datasets-server error: ${body.error}`);
  return { rows: body.rows.map(item => item.row), total: body.num_rows_total };
}

/** Case-insensitive match on application_website, e.g. "amazon" matches "Amazon". */
export const matchesSite = (row: PsaiRow, site: string | undefined) => !site || row.application_website.toLowerCase().includes(site.toLowerCase());

export interface PsaiConvertOptions {
  /** Height in px of the browser UI above the page viewport (tabs + address bar). Screen clicks above it never reach the page. */
  chromeTopPx: number;
  pointerThrottleMs: number;
  scrollThrottleMs: number;
  effectWindowMs: number;
}
export const PSAI_DEFAULTS: PsaiConvertOptions = { chromeTopPx: 90, pointerThrottleMs: 1000, scrollThrottleMs: 1000, effectWindowMs: 5000 };

const CONTROL_KEYS: Record<string, RecorderKey> = {
  enter: 'Enter', tab: 'Tab', esc: 'Escape', escape: 'Escape', backspace: 'Backspace', delete: 'Delete',
  up: 'ArrowUp', down: 'ArrowDown', left: 'ArrowLeft', right: 'ArrowRight',
};
const COMMIT_KEYS = new Set<RecorderKey>(['Enter', 'Tab', 'Escape']);
const MODIFIERS = /^(ctrl|alt|cmd|shift|caps_lock|win)/;
const BROWSERS = /chrome|msedge|edge|firefox|brave|safari|opera/i;
const BROWSER_TITLE_SUFFIX = / - (Google Chrome|Microsoft.? Edge|Mozilla Firefox|Brave|Opera)$/i;

const isPrintable = (name: string) => name.length === 1 || name === 'space';
const pageTitle = (title: string) => title.replace(BROWSER_TITLE_SUFFIX, '').trim();
const isAddressBarPage = (title: string) => /^(about:blank|new tab|untitled)$/i.test(pageTitle(title)) || title.trim() === '';

export function convertPsaiRow(row: PsaiRow, options: PsaiConvertOptions = PSAI_DEFAULTS): StagedTask {
  const metadata = JSON.parse(row.metadata) as { start_time?: string; screen_width?: number; screen_height?: number };
  const raw = (JSON.parse(row.events) as RawEvent[]).filter(event => Number.isFinite(event.time_stamp)).sort((a, b) => a.time_stamp - b.time_stamp);
  const width = metadata.screen_width ?? 1920, height = metadata.screen_height ?? 1080, top = options.chromeTopPx;
  const t0 = raw[0]?.time_stamp ?? 0;
  const ms = (event: RawEvent) => Math.round((event.time_stamp - t0) * 1000);
  const { origin, resolvedBy } = resolveOrigin(row.application_website, row.task_name, row.application_website || row.unique_data_id);
  const usePress = raw.some(event => event.action === 'click' && event.pressed === true);

  const stats: Record<string, number> = { clicks: 0, browserUiClicks: 0, nonBrowserEvents: 0, addressBarEvents: 0, typedCommits: 0, keys: 0, scrolls: 0, pointers: 0, effects: 0, shortcutKeysIgnored: 0 };
  const events: StagedEvent[] = [];
  let inBrowser = false, inPage = false, title = '', lastTitle = '';
  let ctrlDown = false, lastPointer = -Infinity, lastScroll = -Infinity;
  const typing = { lastMs: 0, count: 0 };
  const pendingClicks: { event: StagedEvent; untilMs: number }[] = [];

  const flushTyped = () => {
    if (!typing.count) return;
    events.push(stagedEvent({ offsetMs: typing.lastMs, kind: 'change', tag: 'INPUT' }));
    stats.typedCommits++; typing.count = 0;
  };
  const viewportXY = (x: number, y: number) => ({ x: x / width, y: (y - top) / (height - top) });

  for (const event of raw) {
    const at = ms(event);
    if (event.action === 'window_focus') {
      const wasInPage = inPage;
      inBrowser = BROWSERS.test(event.app_name ?? '') || BROWSER_TITLE_SUFFIX.test(event.window_title ?? '');
      inPage = inBrowser && !isAddressBarPage(event.window_title ?? '') && !/ wants to$/i.test(event.window_title ?? '');
      if (inPage) {
        const next = pageTitle(event.window_title ?? '');
        if (next && next !== lastTitle) {
          // A new document title shortly after a click is the dataset's visible "content changed" signal.
          for (const pending of pendingClicks) if (at <= pending.untilMs && !pending.event.effect) { pending.event.effect = 'content-changed'; stats.effects++; }
          pendingClicks.length = 0;
          lastTitle = next;
        }
        title = lastTitle || title;
      }
      if (wasInPage && !inPage) flushTyped();
      continue;
    }
    if (event.action === 'modifier_change') { if (/^ctrl|^cmd|^alt/.test(event.name ?? '')) ctrlDown = event.state === 'pressed'; continue; }
    if (event.action === 'dom_snapshot') continue;
    if (!inBrowser) { stats.nonBrowserEvents++; continue; }
    if (!inPage) { stats.addressBarEvents++; continue; }

    switch (event.action) {
      case 'click': {
        if ((usePress ? event.pressed !== true : event.pressed !== false) || event.button !== 'left') break;
        const x = event.x ?? 0, y = event.y ?? 0;
        if (y < top || y > height || x < 0 || x > width) { stats.browserUiClicks++; flushTyped(); break; }
        flushTyped();
        const click = stagedEvent({ offsetMs: at, kind: 'click', tag: 'OTHER', ...viewportXY(x, y) });
        events.push(click); stats.clicks++;
        pendingClicks.push({ event: click, untilMs: at + options.effectWindowMs });
        break;
      }
      case 'release': {
        const name = (event.name ?? '').toLowerCase();
        if (MODIFIERS.test(name) || name === 'unknown') break;
        if (name === 'ctrl_l' || name === 'ctrl_r') { ctrlDown = false; break; }
        if (isPrintable(name)) {
          if (ctrlDown) { stats.shortcutKeysIgnored++; break; }
          typing.lastMs = at; typing.count++;
          break;
        }
        const key = CONTROL_KEYS[name];
        if (!key) break;
        if (COMMIT_KEYS.has(key)) flushTyped();
        events.push(stagedEvent({ offsetMs: at, kind: 'key', tag: typing.count || key === 'Backspace' || key === 'Delete' ? 'INPUT' : 'OTHER', key }));
        stats.keys++;
        break;
      }
      case 'scroll': {
        if (at - lastScroll < options.scrollThrottleMs) break;
        lastScroll = at;
        events.push(stagedEvent({ offsetMs: at, kind: 'scroll', tag: 'PAGE' })); stats.scrolls++;
        break;
      }
      case 'move': {
        if (at - lastPointer < options.pointerThrottleMs) break;
        const x = event.x ?? 0, y = event.y ?? 0;
        if (y < top || y > height || x < 0 || x > width) break;
        lastPointer = at;
        events.push(stagedEvent({ offsetMs: at, kind: 'pointer', tag: 'OTHER', ...viewportXY(x, y) })); stats.pointers++;
        break;
      }
    }
  }
  flushTyped();
  events.sort((a, b) => a.offsetMs - b.offsetMs);
  const durationMs = raw.length ? ms(raw[raw.length - 1]) : 0;
  const originalStart = metadata.start_time ? new Date(metadata.start_time.replace(' ', 'T') + 'Z').toISOString() : null;
  return {
    origin, title: title || row.application_website || 'Untitled', originalStart, durationMs, events, stats,
    source: {
      dataset: 'anaisleila/computer-use-data-psai', id: row.unique_data_id, taskId: row.taskId, task: row.task_name, site: row.application_website,
      category: row.category, subCategory: row.subCategory, tags: row.tags, difficulty: row.difficulty, originResolvedBy: resolvedBy,
      screen: { width, height, chromeTopPx: top }, screenshots: row.screenshots.map(shot => shot.src), reasoningSteps: row.reasoning_steps,
      videoFile: row.video_file, domSnapsFile: row.dom_snaps_file,
    },
  };
}
