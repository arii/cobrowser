const root = document.getElementById('recording');
root.innerHTML = `<header><p>COBROWSER · LOCAL RECORDER</p><h1 id="recording-state">Loading…</h1>
<p>Records human interaction metadata on <strong id="record-origin">…</strong> while its tab is active and its browser window is focused.</p></header>
<div class="controls"><button id="record-start">Start recording</button><button id="record-pause">Pause</button><button id="record-fixture">Open fixture</button><button id="record-export">Export JSON</button><button id="record-clear">Clear saved data</button></div>
<p id="record-error" role="alert"></p><section class="stats"><div><strong id="record-count">0</strong><span>events saved locally</span></div><div><strong id="record-last">—</strong><span>last saved</span></div><div><strong>24 hours</strong><span>retention · 2,000 event limit</span></div></section>
<p id="record-detail" role="status" aria-live="polite"></p><section id="brain-panel"><h2>Rolling context brain</h2><p id="brain-mode">Not connected. Run pnpm brain:record for live providers or pnpm brain:preview for a synthetic preview.</p>
<h3 id="brain-intent">Waiting for evidence</h3><p id="brain-summary"></p><p id="brain-status"></p><p id="brain-metrics"></p><details><summary>Context decisions and provider log</summary><pre id="brain-journal"></pre></details></section><h2>Recent activity</h2><p id="record-empty">Open the fixture and click a control or change a field, then return here. Events appear after Chrome confirms the save.</p>
<table><thead><tr><th>Time</th><th>Interaction</th><th>Element</th><th>Input metadata</th><th>Tab</th></tr></thead><tbody id="record-events"></tbody></table>
<footer>Local Chrome extension storage in this browser profile. Typed values, page text and printable keys are excluded from event recording. Live brain mode sends masked fixture screenshots to Snap and action/context summaries to the configured context model; the preview uses synthetic responses. Other origins are excluded, as is the agent's own debugger input. Browser restart pauses capture; saved events remain until expiry or deletion. Exported files are yours to manage.</footer>`;
let state;
let busy = false;
const el = id => document.getElementById(id);
async function request(kind) {
  const result = await chrome.runtime.sendMessage({kind:`recording:${kind}`});
  if (!result?.ok) throw new Error(result?.error ?? 'Recorder did not respond. Reload the extension.');
  return result.value;
}
function render(value) {
  state = value;
  renderBrain(value.brain);
  el('recording-state').textContent = value.enabled ? 'Recording is on' : 'Recording is paused';
  el('recording-state').dataset.enabled = String(value.enabled);
  el('record-start').disabled = value.enabled || busy;
  el('record-pause').disabled = !value.enabled || busy;
  el('record-count').textContent = String(value.events.length);
  el('record-last').textContent = value.events.length ? new Date(value.events.at(-1).at).toLocaleTimeString() : '—';
  el('record-origin').textContent = value.origin;
  el('record-empty').textContent = `Switch to ${value.origin} and click a control or change a field, then return here. Events appear after Chrome confirms the save.`;
  el('record-detail').textContent = value.enabled ? `Armed for ${value.origin}. Switch to it to record; this monitor is excluded.` : 'Capture paused. Saved events can still be reviewed and exported.';
  el('record-error').textContent = value.error ?? '';
  el('record-empty').hidden = value.events.length > 0;
  const rows = value.events.slice(-50).reverse().map(event => {
    const row = document.createElement('tr');
    for (const text of [new Date(event.at).toLocaleTimeString(),event.kind,event.tag,event.key??(event.x===undefined?'—':`${Math.round(event.x*100)}%, ${Math.round(event.y*100)}%`),String(event.tabId)]) {
      const cell = document.createElement('td');cell.textContent = text;row.append(cell);
    }
    return row;
  });
  el('record-events').replaceChildren(...rows);
}
function renderBrain(brain) {
  if (!brain) {
    el('brain-mode').textContent='Not connected. Run pnpm brain:record for live providers or pnpm brain:preview for a synthetic preview.';
    el('brain-intent').textContent='Waiting for evidence';
    for (const id of ['brain-summary','brain-status','brain-metrics','brain-journal']) el(id).textContent='';
    return;
  }
  const connected=Date.now()-Date.parse(brain.connectedAt)<10000;
  el('brain-mode').textContent=`${brain.mode==='live'?`LIVE · SubQ Snap + ${brain.contextModel??'context model'}`:'SYNTHETIC PREVIEW · no model calls'} · ${connected?'connected':'feed disconnected or waiting on providers'}`;
  el('brain-intent').textContent=brain.working?.intent??'Waiting for task evidence';
  el('brain-summary').textContent=brain.working?.summary??'';
  el('brain-status').textContent=brain.working?`${brain.working.status} · confidence ${Math.round(brain.working.confidence*100)}% · ${brain.recent.length} recent events · ${brain.archived.length} retired contexts · ${brain.pendingSwitches} task-change confirmations`:'No active task context.';
  el('brain-metrics').textContent=`Snap: ${brain.providers.snap.calls} calls, average ${Math.round(brain.providers.snap.averageMs)} ms · Context: ${brain.providers.context.calls} calls, average ${Math.round(brain.providers.context.averageMs)} ms`;
  el('brain-journal').textContent=brain.journal.slice(-15).map(entry=>JSON.stringify(entry,null,2)).join('\n');
}
for (const action of ['start','pause','clear']) el(`record-${action}`).onclick = async () => {
  busy = true;
  try { render(await request(action)); }
  catch (error) { el('record-error').textContent = error.message; }
  finally { busy = false; if (state) {el('record-start').disabled = state.enabled;el('record-pause').disabled = !state.enabled;} }
};
el('record-fixture').onclick = () => chrome.tabs.create({url:'http://127.0.0.1:3210/'});
el('record-export').onclick = async () => {
  try {
    const saved = await request('status');
    const url = URL.createObjectURL(new Blob([JSON.stringify(saved,null,2)],{type:'application/json'}));
    const link = document.createElement('a');link.href = url;link.download = `cobrowser-recording-${Date.now()}.json`;link.click();
    setTimeout(() => URL.revokeObjectURL(url),1000);
  } catch (error) { el('record-error').textContent = error.message; }
};
async function refresh() {
  if (busy) return;
  try { render(await request('status')); }
  catch (error) { el('record-error').textContent = error.message; }
}
void refresh();
setInterval(refresh,1000);
