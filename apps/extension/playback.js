import { planPlayback } from './playback-plan.js';
import { scope, command } from './agent-tab.js';

// Agent playback: replays saved recording events in the assigned agent tab via
// debugger input. Replay never invents typed values: change events pause for a
// user-supplied value, and origin mismatches pause for a tab switch. State
// lives in session storage so a suspended worker resumes instead of losing
// its place; only one run pumps at a time per worker.
const RECORD_KEY = 'fixtureRecording';
const REPLAY_KEY = 'replay';
const STEP_DELAY_MS = 300;
const NEED_POLL_MS = 500;
const KEY_CODES = { Tab: 9, Enter: 13, Escape: 27, Backspace: 8, Delete: 46, ArrowUp: 38, ArrowDown: 40, ArrowLeft: 37, ArrowRight: 39 };
const ACTIVE = ['running', 'paused', 'needs_user'];

let runToken = 0;
let pumping = false;
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const idle = () => ({ status: 'idle', mode: null, stepIndex: 0, total: 0, steps: [], origins: [], warnings: [], stats: null, need: null, error: null, interrupted: false, startedAt: null, updatedAt: new Date().toISOString() });

async function readReplay() {
  const saved = await chrome.storage.session.get(REPLAY_KEY);
  return saved[REPLAY_KEY] ?? idle();
}
async function writeReplay(state) {
  await chrome.storage.session.set({ [REPLAY_KEY]: { ...state, updatedAt: new Date().toISOString() } });
}
// The monitor polls every second, so the snapshot omits the step list.
function snapshot(state) {
  const { steps: _steps, ...rest } = state;
  return rest;
}
export async function getReplaySnapshot() {
  try { return snapshot(await readReplay()); } catch { return snapshot(idle()); }
}
export async function getAgentTab() {
  try {
    const { assigned } = await chrome.storage.session.get('assigned');
    if (!assigned) return null;
    const tab = await chrome.tabs.get(assigned.tabId);
    let origin = null;
    try { origin = new URL(tab.url ?? '').origin; } catch { /* unknown origin stays null */ }
    return { tabId: tab.id, origin, title: (tab.title ?? '').slice(0, 80) };
  } catch {
    return null;
  }
}
// New recording sessions and Clear invalidate any active run.
export async function cancelReplayForReset(reason) {
  runToken += 1;
  const state = await readReplay();
  if (ACTIVE.includes(state.status)) await writeReplay({ ...state, status: 'cancelled', need: null, error: reason });
}

async function markAgent(tabId) {
  await chrome.storage.session.set({ lastDispatch: { tabId, at: Date.now() } });
}
async function viewport() {
  const { tab } = await scope();
  const metrics = await command('Page.getLayoutMetrics');
  const size = metrics.cssVisualViewport ?? metrics.cssLayoutViewport;
  if (!size || ![size.clientWidth, size.clientHeight].every(value => Number.isFinite(value) && value > 0)) throw new Error('invalid-viewport');
  return { tab, width: size.clientWidth, height: size.clientHeight };
}
async function dispatch(step) {
  switch (step.kind) {
    case 'click':
    case 'move': {
      const { tab, width, height } = await viewport();
      const x = step.x * width, y = step.y * height;
      if (!(x >= 0 && y >= 0 && x < width && y < height)) throw new Error('action-outside-viewport');
      await markAgent(tab.id);
      if (step.kind === 'move') {
        await command('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
        break;
      }
      await command('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
      await command('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
      break;
    }
    case 'scroll': {
      const { tab, width, height } = await viewport();
      await markAgent(tab.id);
      await command('Input.dispatchMouseEvent', { type: 'mouseWheel', x: Math.floor(width / 2), y: Math.floor(height / 2), deltaX: 0, deltaY: step.deltaY });
      break;
    }
    case 'key':
    case 'submit': {
      const { tab } = await scope();
      const key = step.kind === 'submit' ? 'Enter' : step.key;
      const params = { windowsVirtualKeyCode: KEY_CODES[key], key, code: key };
      await markAgent(tab.id);
      await command('Input.dispatchKeyEvent', { type: 'keyDown', ...params, ...(key === 'Enter' ? { text: '\r' } : {}) });
      await command('Input.dispatchKeyEvent', { type: 'keyUp', ...params });
      break;
    }
    default:
      throw new Error('unknown-replay-step');
  }
}

async function pump(token) {
  if (pumping) return;
  pumping = true;
  try {
    for (;;) {
      // Follow superseding runs instead of exiting: resume/input/skip bump the
      // token while this loop still holds the pump guard, so exiting here
      // would strand the run with no loop. Terminal states exit below.
      token = runToken;
      const state = await readReplay();
      if (state.status !== 'running' && state.status !== 'needs_user') return;
      if (state.status === 'needs_user') { await sleep(NEED_POLL_MS); continue; }
      if (state.stepIndex >= state.steps.length) {
        await writeReplay({ ...state, status: 'done', need: null, error: null });
        return;
      }
      const step = state.steps[state.stepIndex];
      const agent = await getAgentTab();
      if (!agent) {
        await writeReplay({ ...state, status: 'failed', need: null, error: 'no-assigned-tab' });
        return;
      }
      if (agent.origin !== step.origin) {
        await writeReplay({ ...state, status: 'needs_user', need: { kind: 'origin', stepIndex: state.stepIndex, origin: step.origin, message: `Step ${state.stepIndex + 1} of ${state.total} was recorded on ${step.origin}. Switch the agent tab to that origin, then press Resume replay.` } });
        continue;
      }
      if (step.kind === 'input') {
        await writeReplay({ ...state, status: 'needs_user', need: { kind: 'input', stepIndex: state.stepIndex, tag: step.tag, message: `Step ${state.stepIndex + 1} of ${state.total}: a ${step.tag} value changed here, but recorded values were never saved. Focus the field in the agent tab, enter the value below, then Send input.` } });
        continue;
      }
      try {
        await dispatch(step);
      } catch (error) {
        await writeReplay({ ...state, status: 'failed', need: null, error: error instanceof Error ? error.message : 'dispatch-failed' });
        return;
      }
      const advanced = await readReplay();
      // Paused, cancelled, or superseded during dispatch: do not advance.
      if (token !== runToken || advanced.status !== 'running') return;
      await writeReplay({ ...advanced, status: 'running', stepIndex: advanced.stepIndex + 1, stats: { ...advanced.stats, dispatched: advanced.stats.dispatched + 1 } });
      await sleep(STEP_DELAY_MS);
    }
  } finally {
    pumping = false;
  }
}

async function start(mode) {
  const current = await readReplay();
  if (ACTIVE.includes(current.status)) throw new Error('replay-already-running');
  const agent = await getAgentTab();
  if (!agent) throw new Error('no-assigned-tab');
  const saved = await chrome.storage.local.get(RECORD_KEY);
  // Replay is scoped to the assigned tab's origin: only that tab family's
  // events run, on any recorded site, never just the fixture.
  const plan = planPlayback(saved[RECORD_KEY]?.events ?? [], { mode, origin: agent.origin ?? undefined });
  runToken += 1;
  const token = runToken;
  const state = {
    status: 'running', mode: plan.mode, stepIndex: 0, total: plan.steps.length, steps: plan.steps,
    origins: plan.origins, warnings: plan.warnings, stats: { dispatched: 0, userInputs: 0, skipped: 0 },
    need: null, error: null, interrupted: false, startedAt: new Date().toISOString(),
  };
  await writeReplay(state);
  void pump(token);
  return state;
}
async function pause() {
  const state = await readReplay();
  if (state.status !== 'running') throw new Error('replay-not-running');
  runToken += 1;
  const paused = { ...state, status: 'paused' };
  await writeReplay(paused);
  return paused;
}
async function resume() {
  const state = await readReplay();
  if (state.status !== 'paused') throw new Error('replay-not-paused');
  runToken += 1;
  const token = runToken;
  const resumed = { ...state, status: state.need ? 'needs_user' : 'running', interrupted: false };
  await writeReplay(resumed);
  void pump(token);
  return resumed;
}
async function cancel() {
  const state = await readReplay();
  if (!ACTIVE.includes(state.status)) throw new Error('replay-not-active');
  runToken += 1;
  const cancelled = { ...state, status: 'cancelled', need: null, error: null };
  await writeReplay(cancelled);
  return cancelled;
}
async function provideInput(text) {
  const state = await readReplay();
  if (state.status !== 'needs_user' || state.need?.kind !== 'input' || state.need.stepIndex !== state.stepIndex) throw new Error('replay-not-waiting-for-input');
  if (typeof text !== 'string' || !text.length || text.length > 1000) throw new Error('invalid-input-text');
  const step = state.steps[state.stepIndex];
  const agent = await getAgentTab();
  if (!agent) throw new Error('no-assigned-tab');
  if (agent.origin !== step.origin) throw new Error('agent-tab-origin-changed');
  await scope();
  await markAgent(agent.tabId);
  await command('Input.insertText', { text });
  runToken += 1;
  const token = runToken;
  const advanced = { ...state, status: 'running', need: null, stepIndex: state.stepIndex + 1, stats: { ...state.stats, dispatched: state.stats.dispatched + 1, userInputs: state.stats.userInputs + 1 } };
  await writeReplay(advanced);
  void pump(token);
  return advanced;
}
async function skipInput() {
  const state = await readReplay();
  if (state.status !== 'needs_user' || state.need?.kind !== 'input' || state.need.stepIndex !== state.stepIndex) throw new Error('replay-not-waiting-for-input');
  runToken += 1;
  const token = runToken;
  const advanced = { ...state, status: 'running', need: null, stepIndex: state.stepIndex + 1, stats: { ...state.stats, skipped: state.stats.skipped + 1 } };
  await writeReplay(advanced);
  void pump(token);
  return advanced;
}
// Assigns an already-open page as the replay target. Unlike popup adoption it
// never reloads: the user prepares the page first, then replays into it.
async function assignTab(tabId) {
  const current = await readReplay();
  if (ACTIVE.includes(current.status)) throw new Error('replay-already-running');
  const { assigned } = await chrome.storage.session.get('assigned');
  if (assigned) throw new Error('stop-existing-assignment-first');
  if (!Number.isInteger(tabId)) throw new Error('invalid-tab');
  let tab;
  try {
    tab = await chrome.tabs.get(tabId);
  } catch {
    throw new Error('unknown-tab');
  }
  if (tab.incognito) throw new Error('adopt-requires-non-incognito-tab');
  let origin;
  try {
    const url = new URL(tab.url ?? '');
    if (!['http:', 'https:'].includes(url.protocol)) throw new Error('adopt-requires-http-tab');
    origin = url.origin;
  } catch (error) {
    throw new Error('adopt-requires-http-tab');
  }
  await chrome.storage.session.set({ assigned: { tabId: tab.id, windowId: tab.windowId, origin } });
  {const {automationTabIds=[]}=await chrome.storage.session.get('automationTabIds');await chrome.storage.session.set({automationTabIds:[...new Set([...automationTabIds,tab.id])]});}
  try {
    await chrome.debugger.attach({ tabId: tab.id }, '1.3');
    await command('Page.enable');
  } catch (error) {
    await detachTab(true);
    throw error;
  }
  return getAgentTab();
}
async function detachTab(force = false) {
  if (!force) {
    const current = await readReplay();
    if (ACTIVE.includes(current.status)) throw new Error('replay-already-running');
  }
  const { assigned } = await chrome.storage.session.get('assigned');
  if (assigned) await chrome.debugger.detach({ tabId: assigned.tabId }).catch(() => {});
  await chrome.storage.session.remove(['assigned', 'observation']);
  return null;
}

chrome.runtime.onMessage.addListener((message, sender, respond) => {
  const isView = sender.id === chrome.runtime.id && !sender.tab?.incognito
    && [chrome.runtime.getURL('recording.html'), chrome.runtime.getURL('popup.html')].includes(sender.url);
  if (!isView || typeof message?.kind !== 'string' || !message.kind.startsWith('replay:')) return;
  (async () => {
    switch (message.kind) {
      case 'replay:start': return snapshot(await start(message.mode));
      case 'replay:pause': return snapshot(await pause());
      case 'replay:resume': return snapshot(await resume());
      case 'replay:cancel': return snapshot(await cancel());
      case 'replay:input': return snapshot(await provideInput(message.text));
      case 'replay:skip': return snapshot(await skipInput());
      case 'replay:assign': return await assignTab(message.tabId);
      case 'replay:detach': return await detachTab();
      default: throw new Error('unknown-replay-command');
    }
  })().then(value => respond({ ok: true, value }), error => respond({ ok: false, error: error instanceof Error ? error.message : 'replay-failed' }));
  return true;
});

// A suspended worker loses its pump loop; the persisted run resumes as paused.
void (async () => {
  try {
    const state = await readReplay();
    if (state.status === 'running') await writeReplay({ ...state, status: 'paused', interrupted: true });
  } catch { /* session storage unavailable; replay stays idle */ }
})();
