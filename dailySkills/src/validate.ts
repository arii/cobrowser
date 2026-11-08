// Mirrors validEvent() in cobrowser apps/extension/recorder.js plus the fields recorder.js adds when it stores an event.
import { RECORDER_KEYS, RECORDER_KINDS, RECORDER_TAGS, type RecorderState } from './recorder-format.js';

const TOP_LEVEL = ['schemaVersion', 'sessionId', 'startedAt', 'events', 'tabs', 'tabCount', 'dropped', 'source'];
const EVENT_FIELDS = ['id', 'sessionId', 'at', 'origin', 'tabId', 'provenance', 'kind', 'tag', 'x', 'y', 'key', 'target', 'effect'];
const CONTENT_FIELDS = ['kind', 'tag', 'x', 'y', 'key', 'target'];
/** Same rule as validTarget() in apps/extension/skill-learning.js. */
export const validTarget = (target: unknown): boolean => {
  const value = target as Record<string, unknown> | null;
  return !!value && typeof value === 'object' && Object.keys(value).every(key => ['tag', 'label', 'type'].includes(key))
    && ['BUTTON', 'A', 'INPUT', 'SELECT', 'TEXTAREA'].includes(value.tag as string)
    && typeof value.label === 'string' && value.label.trim().length > 0 && value.label.length <= 100
    && !/^(unknown|untitled|other|button|click|action|\.{3})$/i.test(value.label.trim())
    && typeof value.type === 'string' && /^[a-z-]{0,30}$/.test(value.type)
    && !['password', 'hidden', 'file', 'checkbox', 'radio'].includes(value.type);
};
const webOrigin = (value: string) => { try { const url = new URL(value); return ['http:', 'https:'].includes(url.protocol) && url.origin === value; } catch { return false; } };

export function validateState(state: RecorderState): string[] {
  const problems: string[] = [];
  const issue = (text: string) => { if (problems.length < 50) problems.push(text); };
  for (const key of Object.keys(state)) if (!TOP_LEVEL.includes(key)) issue(`unexpected top-level key ${key}`);
  if (state.schemaVersion !== 1) issue('schemaVersion must be 1');
  if (typeof state.sessionId !== 'string' || !state.sessionId) issue('sessionId missing');
  if (Number.isNaN(Date.parse(state.startedAt))) issue('startedAt is not a date');
  if (!Array.isArray(state.tabs) || state.tabCount !== state.tabs.length) issue('tabCount must match tabs');
  const cutoff = Date.now() - 24 * 3600 * 1000;
  let stale = 0, previous = -Infinity;
  state.events.forEach((event, index) => {
    const where = `event[${index}]`;
    for (const key of Object.keys(event)) if (!EVENT_FIELDS.includes(key)) issue(`${where}: unexpected field ${key}`);
    const content = Object.fromEntries(Object.entries(event).filter(([key]) => CONTENT_FIELDS.includes(key)));
    if (!RECORDER_KINDS.includes(event.kind)) issue(`${where}: bad kind ${event.kind}`);
    if (!RECORDER_TAGS.includes(event.tag)) issue(`${where}: bad tag ${event.tag}`);
    const hasXY = content.x !== undefined || content.y !== undefined;
    if (hasXY && !(['pointer', 'click'].includes(event.kind) && Number.isFinite(event.x) && Number.isFinite(event.y) && event.x! >= 0 && event.x! <= 1 && event.y! >= 0 && event.y! <= 1)) issue(`${where}: x/y only on pointer/click within 0..1`);
    if (content.key !== undefined && !(event.kind === 'key' && RECORDER_KEYS.includes(event.key!))) issue(`${where}: bad key`);
    if (content.target !== undefined) {
      const target = event.target!;
      if (!['click', 'change'].includes(event.kind)) issue(`${where}: target only on click/change`);
      if (!validTarget(target)) issue(`${where}: invalid target ${JSON.stringify(target)}`);
    }
    if (event.effect !== undefined && (event.effect !== 'content-changed' || event.kind !== 'click')) issue(`${where}: effect only 'content-changed' on click`);
    if (event.provenance !== 'human') issue(`${where}: provenance must be human`);
    if (event.sessionId !== state.sessionId) issue(`${where}: sessionId differs from state`);
    if (!Number.isInteger(event.tabId) || event.tabId < 0) issue(`${where}: tabId must be a non-negative integer`);
    if (!webOrigin(event.origin)) issue(`${where}: origin must be a bare http(s) origin, got ${event.origin}`);
    const at = Date.parse(event.at);
    if (Number.isNaN(at)) issue(`${where}: at is not a date`); else { if (at < previous) issue(`${where}: events out of order`); previous = at; if (at < cutoff) stale++; }
  });
  if (stale) issue(`${stale} events are older than the recorder's 24h retention and would be dropped on load (use --rebase now)`);
  return problems;
}
