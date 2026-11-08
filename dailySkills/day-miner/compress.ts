// A day of recorder events -> compact numbered lines a model can read in one pass. Values were never recorded;
// labels, titles and origins are all that leave the machine.
import type { RecorderEvent, RecorderState } from '../src/recorder-format.js';

export interface Compressed { lines: string[]; byRef: Map<number, RecorderEvent>; tabs: Map<number, string>; firstAt: number; eventCount: number }
const MEANINGFUL = new Set(['click', 'change', 'submit', 'key', 'page-visible']);
const clock = (ms: number) => { const total = Math.max(0, Math.round(ms / 1000)); const h = Math.floor(total / 3600), m = Math.floor((total % 3600) / 60), s = total % 60; return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`; };
const describe = (event: RecorderEvent) => {
  if (event.target) return `${event.target.tag} "${event.target.label}"${event.target.type ? ` type=${event.target.type}` : ''}`;
  if (event.kind === 'key') return event.key ?? 'key';
  if (event.x !== undefined) return `unlabeled ${event.tag} at ${Math.round(event.x * 100)}%,${Math.round(event.y! * 100)}%`;
  return event.tag;
};

export function compress(states: RecorderState[], options: { maxEvents?: number } = {}): Compressed {
  const events = states.flatMap(state => state.events).filter(event => MEANINGFUL.has(event.kind)).sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  const kept = options.maxEvents && events.length > options.maxEvents ? events.slice(-options.maxEvents) : events;
  const tabs = new Map<number, string>();
  for (const state of states) for (const tab of state.tabs ?? []) tabs.set(tab.tabId, tab.title);
  const firstAt = kept.length ? Date.parse(kept[0].at) : Date.now();
  const byRef = new Map<number, RecorderEvent>();
  const lines: string[] = []; let lastTab: number | null = null;
  kept.forEach((event, index) => {
    const ref = index + 1; byRef.set(ref, event);
    const parts = [`#${ref}`, `+${clock(Date.parse(event.at) - firstAt)}`, `tab${event.tabId}`, event.origin, event.kind, describe(event)];
    if (event.effect) parts.push(`-> ${event.effect}`);
    if (event.tabId !== lastTab) { const title = tabs.get(event.tabId); if (title) parts.splice(4, 0, `[${title.slice(0, 80)}]`); lastTab = event.tabId; }
    lines.push(parts.join(' '));
  });
  return { lines, byRef, tabs, firstAt, eventCount: kept.length };
}
