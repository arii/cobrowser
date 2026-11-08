// Pure recording-to-replay planner. No chrome APIs: the extension background and
// the Node test suite share this file. Typed values were never recorded, so
// change events always become input pauses rather than invented keystrokes.
export const PLAYBACK_VERSION = 1;
export const PLAYBACK_EVENT_LIMIT = 2000;
// The recorder captures that a scroll happened, never its distance. Direct
// playback states this fallback openly instead of pretending it is recorded.
export const DIRECT_SCROLL_DELTA_Y = 200;

const KINDS = ['click', 'change', 'submit', 'scroll', 'page-visible', 'pointer', 'key'];
const TAGS = ['INPUT', 'SELECT', 'TEXTAREA', 'BUTTON', 'A', 'FORM', 'PAGE', 'OTHER'];
const KEYS = ['Tab', 'Enter', 'Escape', 'Backspace', 'Delete', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'];

function validOrigin(value) {
  if (typeof value !== 'string') return false;
  try {
    const url = new URL(value);
    return ['http:', 'https:'].includes(url.protocol) && url.origin === value;
  } catch {
    return false;
  }
}

function validEvent(event) {
  if (!event || typeof event !== 'object') return false;
  if (typeof event.id !== 'string' || !event.id || event.id.length > 300) return false;
  if (typeof event.at !== 'string' || !Number.isFinite(Date.parse(event.at))) return false;
  if (!validOrigin(event.origin)) return false;
  if (!KINDS.includes(event.kind) || !TAGS.includes(event.tag)) return false;
  const hasX = event.x !== undefined, hasY = event.y !== undefined;
  if (hasX !== hasY) return false;
  if (hasX && (!['click', 'pointer'].includes(event.kind) || !Number.isFinite(event.x) || !Number.isFinite(event.y)
    || event.x < 0 || event.x > 1 || event.y < 0 || event.y > 1)) return false;
  if (event.kind === 'key' && !KEYS.includes(event.key)) return false;
  if (event.kind !== 'key' && event.key !== undefined) return false;
  return true;
}

// Maps recorded events to replay steps in recorded order.
// Direct mode replays literally (pointer moves, assumed scroll distance).
// Filtered mode drops pointer/scroll/page noise and keeps decided actions.
export function planPlayback(events, options = {}) {
  const mode = options.mode ?? 'filtered';
  if (!['direct', 'filtered'].includes(mode)) throw new Error('invalid-playback-mode');
  const scope = options.origin ?? null;
  if (scope !== null && !validOrigin(scope)) throw new Error('invalid-playback-scope');
  if (!Array.isArray(events) || events.length === 0) throw new Error('empty-playback');
  if (events.length > PLAYBACK_EVENT_LIMIT) throw new Error('playback-event-limit');
  const steps = [], skipped = [], origins = [], warnings = [];
  for (const event of events) {
    if (!validEvent(event)) throw new Error('invalid-playback-event');
    if (!origins.includes(event.origin)) origins.push(event.origin);
    const base = { eventId: event.id, at: event.at, origin: event.origin };
    const skip = reason => skipped.push({ ...base, kind: event.kind, reason });
    if (scope !== null && event.origin !== scope) { skip('other-origin'); continue; }
    switch (event.kind) {
      case 'click':
        if (event.x === undefined) skip('missing-coordinates');
        else steps.push({ ...base, kind: 'click', tag: event.tag, x: event.x, y: event.y });
        break;
      case 'change':
        steps.push({ ...base, kind: 'input', tag: event.tag });
        break;
      case 'submit':
        steps.push({ ...base, kind: 'submit', tag: event.tag });
        break;
      case 'key':
        steps.push({ ...base, kind: 'key', tag: event.tag, key: event.key });
        break;
      case 'scroll':
        if (mode === 'direct') steps.push({ ...base, kind: 'scroll', tag: event.tag, deltaY: DIRECT_SCROLL_DELTA_Y, assumed: true });
        else skip('filtered-noise');
        break;
      case 'pointer':
        if (mode !== 'direct') skip('filtered-noise');
        else if (event.x === undefined) skip('missing-coordinates');
        else steps.push({ ...base, kind: 'move', tag: event.tag, x: event.x, y: event.y });
        break;
      default:
        skip(mode === 'direct' ? 'non-actionable' : 'filtered-noise');
    }
  }
  if (mode === 'direct' && steps.some(step => step.kind === 'scroll')) {
    warnings.push(`scroll distance was never recorded; direct replay scrolls ${DIRECT_SCROLL_DELTA_Y}px per scroll event`);
  }
  if (scope !== null) {
    if (steps.length === 0) throw new Error('no-events-for-tab');
    const foreign = skipped.filter(item => item.reason === 'other-origin').length;
    if (foreign > 0) warnings.push(`${foreign} event(s) from other origins skipped; replaying ${scope} only`);
  } else if (origins.length > 1) {
    warnings.push(`${origins.length} origins recorded; replay pauses until the agent tab matches each step origin`);
  }
  return { version: PLAYBACK_VERSION, mode, totalEvents: events.length, steps, skipped, origins, warnings };
}
