// Shared assigned-tab scope for debugger input. Used by the Phase 0 probes and
// by agent playback; behavior is unchanged from background.js.
export const ORIGIN = 'http://127.0.0.1:3210';

export function tabOrigin(tab) {
  try { return new URL(tab.url ?? '').origin; } catch { return ''; }
}

export async function scope() {
  const { assigned } = await chrome.storage.session.get('assigned');
  if (!assigned) throw new Error('no-assigned-tab');
  const tab = await chrome.tabs.get(assigned.tabId);
  if (tab.incognito || tabOrigin(tab) !== (assigned.origin ?? ORIGIN) || tab.windowId !== assigned.windowId) throw new Error('scope-lost');
  return { tab, assigned, target: { tabId: tab.id } };
}

export async function command(method, params = {}) {
  const { target } = await scope();
  return chrome.debugger.sendCommand(target, method, params);
}
