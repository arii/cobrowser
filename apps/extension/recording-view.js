const root = document.getElementById('recording');
root.innerHTML = `<header><p>COBROWSER · LOCAL RECORDER</p><p><a href="skills.html" target="_blank">Open skills library</a></p><h1 id="recording-state">Loading…</h1>
<p>Records human interaction metadata on <strong id="record-origin">…</strong> with interaction events from the active tab and its browser window is focused.</p></header>
<div class="controls"><button id="record-start">Start recording</button><button id="record-pause">Pause</button><button id="record-fixture">Open fixture</button><button id="record-export">Export JSON</button><button id="record-clear">Clear saved data</button></div>
<p id="record-error" role="alert"></p><section class="stats"><div><strong id="record-count">0</strong><span>events saved locally</span></div><div><strong id="record-last">—</strong><span>last saved</span></div><div><strong>24 hours</strong><span>live window · latest 2,000 events</span></div></section>
<p id="record-detail" role="status" aria-live="polite"></p><section id="dataset-panel"><h2>Dataset recordings</h2><p>Test with a recording converted from a public dataset (<code>dailySkills/</code> in the repo, <code>pnpm convert …</code>) instead of live capture. Loading one pauses recording and sets the live data aside; switching off, or pressing Start recording, restores it. Clear saved data discards both.</p>
<div class="controls"><label class="toggle"><input type="checkbox" id="dataset-toggle"> Use dataset recording</label><button id="dataset-choose">Choose JSON…</button><input type="file" id="dataset-file" accept="application/json,.json" hidden></div>
<p id="dataset-status" role="status" aria-live="polite"></p><p id="dataset-error" role="alert"></p><details id="dataset-tasks-details" hidden><summary>Tasks in this recording</summary><table><thead><tr><th>Tab</th><th>Site</th><th>Task</th></tr></thead><tbody id="dataset-tasks"></tbody></table></details></section><section id="brain-panel"><h2>Rolling context brain</h2><p id="brain-mode">Not connected. Run pnpm brain:record for live providers or pnpm brain:preview for a synthetic preview.</p>
<h3 id="brain-intent">Waiting for evidence</h3><p id="brain-summary"></p><p id="brain-status"></p><p id="brain-phase" role="status" aria-live="polite"></p><p id="visual-status"></p><p id="brain-metrics"></p><p id="brain-error" role="alert"></p><h3>Likely next action · a guess</h3><p id="brain-next">Waiting for a prediction</p><p id="brain-next-detail"></p><details><summary>Context decisions and provider log</summary><pre id="brain-journal"></pre></details></section><section id="skill-decisions-panel"><h2>Live skill decisions</h2><p>One supported attempt saves an inactive skill immediately. This feed shows current activity, observed evidence, model assessments and concrete blockers.</p><p id="skill-decision-status" role="status" aria-live="polite">Checking workflows…</p><p id="skill-run-status" role="status" aria-live="polite"></p><p id="skill-model-assessment"></p><div id="skill-decisions"></div></section><section id="assumption-panel"><h2>Context assumptions over time</h2><p>About every 10 seconds while a web page is focused. These are revisable guesses based on visible evidence.</p><div id="assumption-timeline"></div></section><h2>Open tabs</h2><p id="tab-count"></p><table><thead><tr><th>Tab</th><th>Page</th><th>Origin</th><th>Read status / page content</th></tr></thead><tbody id="open-tabs"></tbody></table><h2>Recent activity</h2><p id="record-empty">Open the fixture and click a control or change a field, then return here. Events appear after Chrome confirms the save.</p>
<table><thead><tr><th>Time</th><th>Interaction</th><th>Element</th><th>Input metadata</th><th>Origin / tab</th></tr></thead><tbody id="record-events"></tbody></table>
<footer>Local Chrome extension storage in this browser profile. Typed values, page text and printable keys are excluded from event recording. Bounded control labels are saved to identify replay targets. Run workflows from the skills library with an instruction and the websites they need. Skill actions are excluded from human recordings. Live brain mode sends masked active-tab screenshots to Snap and Gemini for visual summaries, and open-tab titles, headings, page excerpts, bounded before/after DOM snapshots and motion/context summaries to the context model. Raw screenshots stay in memory; derived summaries and assumptions are saved locally; the preview uses synthetic responses. Incognito and browser-internal pages are excluded, as is the agent's own debugger input. Predictions are guesses and never trigger actions. Browser restart pauses capture; the live window expires, while full local action history remains until Clear saved data. Exported files are yours to manage.</footer>`;
let state;
let busy = false;
let renderedTabsKey='',renderedAssumptionsKey='',renderedSkillDecisionsKey='';
const el = id => document.getElementById(id);
async function request(kind) {
  const result = await chrome.runtime.sendMessage({kind:`recording:${kind}`});
  if (!result?.ok) throw new Error(result?.error ?? 'Recorder did not respond. Reload the extension.');
  return result.value;
}
function render(value) {
  state = value;
  renderBrain(value.brain);
  renderDataset(value);
  el('recording-state').textContent = value.enabled ? 'Recording is on' : 'Recording is paused';
  el('recording-state').dataset.enabled = String(value.enabled);
  el('record-start').disabled = value.enabled || busy;
  el('record-pause').disabled = !value.enabled || busy;
  el('record-count').textContent = String(value.events.length);
  el('record-last').textContent = value.events.length ? new Date(value.events.at(-1).at).toLocaleTimeString() : '—';
  el('record-origin').textContent = value.origin;
  el('record-empty').textContent = `Switch to any HTTP/HTTPS tab and click a control or change a field, then return here. Events appear after Chrome confirms the save.`;
  el('record-detail').textContent = value.enabled ? `Reading open HTTP/HTTPS tabs. Interact with a page to update the brain; this monitor is excluded. ${value.dropped??0} older events rotated.` : 'Capture paused. Saved events can still be reviewed and exported.';
  el('record-error').textContent = value.error ?? '';
  el('record-empty').hidden = value.events.length > 0;
  const rows = value.events.slice(-50).reverse().map(event => {
    const row = document.createElement('tr');
    for (const text of [new Date(event.at).toLocaleTimeString(),event.kind,event.tag,event.key??(event.x===undefined?'—':`${Math.round(event.x*100)}%, ${Math.round(event.y*100)}%`),`${event.origin} · ${event.tabId}`]) {
      const cell = document.createElement('td');cell.textContent = text;row.append(cell);
    }
    return row;
  });
  el('record-events').replaceChildren(...rows);
  el('tab-count').textContent=`${value.tabs?.length??0} of ${value.tabCount??value.tabs?.length??0} supported tabs (up to 200 recent tabs).`;
  const tabsKey=JSON.stringify((value.tabs??[]).map(({observedAt:_observedAt,...tab})=>tab));
  if(tabsKey!==renderedTabsKey){
  const open=new Set([...el('open-tabs').querySelectorAll('details[open]')].map(detail=>detail.dataset.tab));
  renderedTabsKey=tabsKey;
  el('open-tabs').replaceChildren(...(value.tabs??[]).map(tab=>{
    const row=document.createElement('tr');
    for(const text of [String(tab.tabId),tab.title||'(untitled)',tab.origin]) {const cell=document.createElement('td');cell.textContent=text;row.append(cell);}
    const cell=document.createElement('td');
    const details=document.createElement('details');details.dataset.tab=String(tab.tabId);details.open=open.has(String(tab.tabId));const summary=document.createElement('summary');
    summary.textContent=`${tab.readStatus} · ${tab.excerpt?.length??0} characters · ${tab.headings?.length??0} headings`;details.append(summary);
    for(const text of [tab.readError??'',...(tab.headings??[]),tab.excerpt||'No readable page text returned.']){if(!text)continue;const paragraph=document.createElement('p');paragraph.textContent=text;details.append(paragraph);}
    cell.append(details);row.append(cell);
    return row;
  }));
  }
}
function datasetErrorText(code) {
  if (typeof code !== 'string') return 'Dataset load did not respond. Reload the extension.';
  const event = /^dataset-event-(\d+)-(.+)$/.exec(code);
  if (event) {
    const reasons = {'rejected-by-recorder':'has content the recorder would never store (check kind, tag, x/y, key, target).','session-mismatch':'does not belong to the file\'s sessionId.','bad-origin':'needs a bare http(s) origin.','out-of-order':'is earlier than the event before it.','bad-time':'has an unreadable timestamp.','not-human':'must have provenance "human".'};
    return `Event ${event[1]} ${reasons[event[2]] ?? `failed: ${event[2]}.`}`;
  }
  return {
    'dataset-not-an-object':'Expected a recorder state object (the Export JSON shape).',
    'dataset-unsupported-schema':'Only schemaVersion 1 recordings are supported.',
    'dataset-missing-session':'The recording has no sessionId.',
    'dataset-no-events':'The recording has no events.',
    'dataset-too-many-events':'The recording is too large; convert fewer tasks.',
    'dataset-duplicate-event-ids':'Event ids repeat; regenerate the file.',
    'dataset-all-events-expired':'Every event is older than 24 hours. Re-run the converter (default --rebase now).',
  }[code] ?? code;
}
function renderDataset(value) {
  const dataset = value.dataset ?? null;
  el('dataset-toggle').checked = Boolean(dataset);
  el('dataset-toggle').disabled = busy;
  el('dataset-choose').disabled = busy;
  el('dataset-status').textContent = dataset
    ? `${dataset.name}: ${dataset.eventCount} events across ${dataset.tabCount} tab(s), loaded ${new Date(dataset.loadedAt).toLocaleTimeString()}.${dataset.expired ? ` ${dataset.expired} events older than 24 hours were left out.` : ''}${dataset.dropped ? ` ${dataset.dropped} oldest events were rotated out at the ${value.limit ?? 2000}-event cap.` : ''} Live recording is set aside until this is switched off.`
    : 'Off. Live recording behaves as usual.';
  const rows = (dataset?.tasks ?? []).map(task => {
    const row = document.createElement('tr');
    for (const text of [String(task.tabId), task.site || task.dataset || '—', task.task || '—']) { const cell = document.createElement('td'); cell.textContent = text; row.append(cell); }
    return row;
  });
  el('dataset-tasks').replaceChildren(...rows);
  el('dataset-tasks-details').hidden = rows.length === 0;
}
function renderBrain(brain) {
  const activity=state?.brainActivity;
  el('brain-phase').textContent=!state?.enabled?'Observation paused':activity?.sessionId===state?.sessionId?`Activity: ${activity.phase}`:'Waiting for the next observation';
  el('visual-status').textContent=state?.visualCapture?`Screenshot capture: ${state.visualCapture.status} · ${new Date(state.visualCapture.at).toLocaleTimeString()}`:'Screenshot capture waits for a focused HTTP/HTTPS page.';
  renderAssumptions(brain?.assumptions??[]);
  if (!brain) {
    const connection=state?.brainConnection;
    el('brain-mode').textContent=connection?.status==='connecting'?'Connecting this Chrome profile to the local brain…':connection?.status==='unavailable'?'Local brain unavailable. Run pnpm install:context-host, then retry recording.':connection?.status==='error'?`Local brain error: ${connection.code}`:'Waiting for the local brain connection. Start recording to connect this Chrome profile.';
    el('brain-intent').textContent='Waiting for evidence';
    for (const id of ['brain-summary','brain-status','brain-metrics','brain-journal','brain-next-detail','brain-error']) el(id).textContent='';
    el('brain-next').textContent='Waiting for a prediction';
    return;
  }
  const connected=Date.now()-Date.parse(brain.connectedAt)<10000 || (state?.brainConnection?.status==='connected' && activity?.sessionId===state?.sessionId && Date.now()-Date.parse(activity.at)<65000);
  el('brain-mode').textContent=`${brain.mode==='live'?`LIVE · SubQ Snap + ${brain.contextModel??'context model'}`:'SYNTHETIC PREVIEW · no model calls'} · ${connected?'connected':'feed disconnected or waiting on providers'}`;
  el('brain-intent').textContent=brain.working?.intent??'Waiting for task evidence';
  el('brain-summary').textContent=brain.working?.summary??'';
  el('brain-status').textContent=brain.working?`${brain.working.status} · confidence ${Math.round(brain.working.confidence*100)}% · ${brain.recent.length} recent events · ${brain.history?.totalActions??0} retained task actions · ${brain.history?.archivedTasks??brain.archived.length} archived tasks · ${brain.pendingSwitches} task-change confirmations`:'No active task context.';
  el('brain-metrics').textContent=`Snap: ${brain.providers.snap.calls} calls, average ${Math.round(brain.providers.snap.averageMs)} ms · Context: ${brain.providers.context.calls} calls, average ${Math.round(brain.providers.context.averageMs)} ms`;
  const latestStatus=brain.journal.findLast(entry=>entry.kind==='provider-result'||entry.kind==='provider-unavailable');
  el('brain-error').textContent=latestStatus?.kind==='provider-unavailable'?`${latestStatus.provider} unavailable: ${latestStatus.code??'no response'}. Next-action prediction is waiting for valid model output.`:'';
  const next=brain.working?.nextAction;
  el('brain-next').textContent=next?.description??'Prediction unavailable';
  const target=(state.tabs??[]).find(tab=>tab.tabId===next?.targetTabId);
  el('brain-next-detail').textContent=next?`${next.kind} · confidence ${Math.round(next.confidence*100)}%${next.targetTabId!==null?` · target: ${target?.title||next.targetTabId}`:''} · based on ${next.evidenceIds.length} event(s)`:'No supported guess yet.';
  el('brain-journal').textContent=brain.journal.slice(-15).map(entry=>JSON.stringify(entry,null,2)).join('\n');
}
for (const action of ['start','pause','clear']) el(`record-${action}`).onclick = async () => {
  busy = true;
  try { render(await request(action)); }
  catch (error) { el('record-error').textContent = error.message; }
  finally { busy = false; if (state) {el('record-start').disabled = state.enabled;el('record-pause').disabled = !state.enabled;} }
};
el('record-fixture').onclick = () => chrome.tabs.create({url:'http://127.0.0.1:3210/'});
async function datasetRequest(kind, extra = {}) {
  const result = await chrome.runtime.sendMessage({ kind: `recording:${kind}`, ...extra });
  if (!result?.ok) throw new Error(datasetErrorText(result?.error));
  return result.value;
}
el('dataset-choose').onclick = () => el('dataset-file').click();
el('dataset-file').onchange = async () => {
  const file = el('dataset-file').files?.[0];
  el('dataset-file').value = '';
  if (!file) { if (state) renderDataset(state); return; }
  busy = true;
  el('dataset-error').textContent = '';
  try {
    let parsed;
    try { parsed = JSON.parse(await file.text()); } catch { throw new Error('That file is not valid JSON.'); }
    render(await datasetRequest('dataset-load', { name: file.name, state: parsed }));
  } catch (error) { el('dataset-error').textContent = error.message; if (state) renderDataset(state); }
  finally { busy = false; if (state) renderDataset(state); }
};
el('dataset-toggle').onchange = async () => {
  if (el('dataset-toggle').checked) {
    // Switching on without a loaded file asks for one; render() sets the box once the load succeeds.
    if (!state?.dataset) { el('dataset-toggle').checked = false; el('dataset-file').click(); }
    return;
  }
  busy = true;
  el('dataset-error').textContent = '';
  try { render(await datasetRequest('dataset-unload')); }
  catch (error) { el('dataset-error').textContent = error.message; if (state) renderDataset(state); }
  finally { busy = false; if (state) renderDataset(state); }
};
el('record-export').onclick = async () => {
  try {
    const saved = await request('export');
    const url = URL.createObjectURL(new Blob([JSON.stringify(saved,null,2)],{type:'application/json'}));
    const link = document.createElement('a');link.href = url;link.download = `cobrowser-recording-${Date.now()}.json`;link.click();
    setTimeout(() => URL.revokeObjectURL(url),1000);
  } catch (error) { el('record-error').textContent = error.message; }
};
async function refresh() {
  if (busy) return;
  try {
    render(await request('status'));
    const result=await chrome.runtime.sendMessage({kind:'skills:list'});
    if(!result?.ok)throw new Error(result?.error??'Skill decisions are unavailable.');
    renderSkillDecisions(result.value);
  }
  catch (error) { el('skill-decision-status').textContent = `Monitor update unavailable: ${error.message}`; }
}
void refresh();
setInterval(refresh,1000);

function renderAssumptions(assumptions){
  const key=assumptions.map(item=>item.id).join('|');
  if(key===renderedAssumptionsKey)return;renderedAssumptionsKey=key;
  el('assumption-timeline').replaceChildren(...assumptions.slice(-12).reverse().map(item=>{
    const card=document.createElement('article');card.className='assumption';
    const add=(tag,text)=>{const node=document.createElement(tag);node.textContent=text;card.append(node);return node;};
    add('time',new Date(item.at).toLocaleTimeString());add('h3',item.decision.intent);
    add('p',`${Math.round(item.decision.confidence*100)}% confidence · ${item.decision.status}`);
    add('p',item.decision.summary);add('p',`Evidence behind this guess: ${item.decision.explanation}`);
    add('p',`Possible next action: ${item.decision.nextAction.description}`);
    const observation=item.observation;
    if(observation){
      add('h4','Model summary of screenshots');
      add('p',observation.visualSummary?.summary??'Image summary unavailable; this assumption uses other evidence.');
      if(observation.visualSummary?.changes.length)add('p',`Visual changes: ${observation.visualSummary.changes.join('; ')}`);
      const motion=observation.motion;
      add('p',`Movement: ${motion.samples.length} pointer samples · ${motion.distance.toFixed(2)} viewport units traveled · ${motion.clicks} clicks · ${motion.scrolls} scrolls · ${motion.keys} control keys`);
      add('p',observation.before?(observation.before.documentId===observation.after.documentId?`DOM: ${observation.before.nodes.length} → ${observation.after.nodes.length} sampled elements; ${observation.before.excerpt===observation.after.excerpt?'text unchanged':'visible text changed'}`:'DOM: navigation or a new document'):'DOM: first snapshot; no earlier baseline');
      const details=document.createElement('details');const summary=document.createElement('summary');summary.textContent='Inspect before / after DOM snapshots';details.append(summary);
      for(const [label,dom] of [['Before (previous interval)',observation.before],['After (this interval)',observation.after]]){const heading=document.createElement('h4');heading.textContent=label;const pre=document.createElement('pre');pre.textContent=dom?JSON.stringify(dom,null,2):'No previous snapshot';details.append(heading,pre);}
      card.append(details);
    }
    return card;
  }));
}

function renderSkillDecisions(value){
  el('skill-run-status').textContent=value.run?`${value.run.title} · ${value.run.status} · ${value.run.completed}/${value.run.total} steps dispatched. ${value.run.message??''}`:'';
  const assessment=state?.brain?.assumptions?.findLast(item=>item.decision?.skillAssessment)?.decision.skillAssessment;
  el('skill-model-assessment').textContent=assessment?`Latest model assessment: ${assessment.title} · ${assessment.reusable?'supports reuse':'uncertain about reuse'} (${Math.round(assessment.confidence*100)}%) · ${assessment.reason}. Local replay evidence can save a skill immediately.`:'The local learner can save skills while the context model is still assessing the task.';
  el('skill-decision-status').textContent=`${state?.enabled?'Learning live':'Recording paused'} · ${state?.brainActivity?.phase??'waiting for activity'} · ${value.skills.filter(skill=>!skill.needsExamples).length} supported skills saved · updated ${new Date().toLocaleTimeString()}`;
  const items=value.learning??[],key=JSON.stringify(items);
  if(key===renderedSkillDecisionsKey)return;renderedSkillDecisionsKey=key;
  const cards=items.map(item=>{
    const card=document.createElement('article');card.className='assumption';
    const add=(tag,text)=>{const node=document.createElement(tag);node.textContent=text;card.append(node);};
    add('time',new Date(item.at).toLocaleTimeString());
    add('h3',`${item.status.toUpperCase()} · ${item.title}`);
    add('p',item.reason);
    for(const blocker of item.blockers??[])if(blocker!==item.reason)add('p',`Missing requirement: ${blocker}`);
    add('p',`Observed completed attempts: ${item.observedExamples} · required: ${item.requiredExamples} · evidence: ${item.evidenceIds.join(', ')}`);
    if(item.modelAssessment)add('p',`Model assessment: ${item.modelAssessment.reason} (${Math.round(item.modelAssessment.confidence*100)}% confidence). ${item.status==='saved'?'The supported local attempt is sufficient to save this skill.':''}`);
    return card;
  });
  if(!cards.length){const empty=document.createElement('p');empty.textContent='No workflow observed yet. Use a website to complete a task; one supported attempt is enough.';cards.push(empty);}
  el('skill-decisions').replaceChildren(...cards);
}
