const root=document.getElementById('skills');
root.innerHTML=`<style>
#skills{font:14px system-ui;color:#172033;margin:0 0 18px}#skills h1{font-size:24px;margin:10px 0}#skills h2{font-size:17px;margin:18px 0 8px}#skills p{line-height:1.5}#skills .muted{color:#596579;font-size:12px}#skills article{border:1px solid #dce2ea;border-radius:10px;padding:12px;margin:10px 0;background:#fff}#skills summary{cursor:pointer;font-weight:600}#skills button{padding:7px 10px;margin:6px 6px 0 0;border:1px solid #cbd5e1;border-radius:6px;background:#f4f7fb;cursor:pointer}#skills button.primary{background:#244ce0;color:white;border-color:#244ce0}#skills button:disabled{opacity:.5;cursor:default}#skills label{display:block;margin:10px 0}#skills input[type=text]{display:block;box-sizing:border-box;width:100%;padding:8px;margin-top:4px;border:1px solid #cbd5e1;border-radius:5px}#skills .blocker,#skills-error{color:#a32a20}#skills ol{padding-left:22px}#skills li{padding:4px 0}#skills-run{background:#edf2ff;padding:10px;border-radius:8px}#skills-refresh{float:right}
</style><button id="skills-refresh">Refresh examples</button><p class="muted">COBROWSER · SKILLS</p><h1>Repeat what works</h1><p>A useful completed attempt can become a skill immediately. Review it, activate it, then repeat it.</p><p id="skills-error" role="alert"></p><section><p id="learning-status" role="status"></p><button id="learning-toggle">Start learning</button></section><h2>Learning progress</h2><div id="learning-progress"></div><p id="task-history-info" class="muted"></p><div id="skills-run" role="status" aria-live="polite" hidden></div><h2>Your skills</h2><div id="skills-library"></div><h2>Suggested from your activity</h2><p class="muted">One completed attempt is enough when its actions and result support reuse. New skills are saved automatically and stay inactive until reviewed.</p><div id="skills-candidates"></div><details data-key="legacy-library"><summary id="skills-legacy-count">Earlier skills needing new examples</summary><div id="skills-legacy"></div></details><p class="muted">Inputs are requested each run; recorded values are never saved. Runs open a separate tab from the active starting page. Stop prevents further steps; completed effects remain. Saved skills remain until you delete them.</p>`;
const el=id=>document.getElementById(id);
let busy=false,lastStructure='',latest;
const nameDrafts=new Map();
async function request(action,args={}){
  const result=await chrome.runtime.sendMessage({kind:`skills:${action}`,...args});
  if(!result?.ok)throw new Error(result?.error??'The extension did not respond. Reload it and try again.');
  return result.value;
}
function text(tag,value,className){const node=document.createElement(tag);node.textContent=value;if(className)node.className=className;return node;}
function button(label,action,primary=false){const node=text('button',label,primary?'primary':'');node.onclick=()=>void act(action);return node;}
async function act(action){if(busy)return;busy=true;el('skills-error').textContent='';try{render(await action());}catch(error){el('skills-error').textContent=error.message;}finally{busy=false;}}
function card(skill,saved){
  const article=document.createElement('article'),details=document.createElement('details');
  details.dataset.key=skill.id??skill.key;
  details.append(text('summary',`${skill.title}${saved?(skill.needsExamples?' · Needs new examples':skill.active?' · Active':' · Inactive'):''}`));
  const nameForm=document.createElement('div'),nameLabel=text('label','Skill name'),nameInput=document.createElement('input');
  nameInput.type='text';nameInput.maxLength=80;nameInput.value=nameDrafts.get(details.dataset.key)??skill.title;nameInput.autocomplete='off';
  nameInput.oninput=()=>nameDrafts.set(details.dataset.key,nameInput.value);nameLabel.append(nameInput);nameForm.append(nameLabel);
  if(saved){
    nameForm.hidden=true;
    details.append(button('Rename',async()=>{nameForm.hidden=!nameForm.hidden;nameInput.focus();return latest;}));
    nameForm.append(button('Save name',async()=>{const value=await request('rename',{id:skill.id,title:nameInput.value});nameDrafts.delete(details.dataset.key);return value;}));
  }
  details.append(nameForm);
  details.append(text('p',`${skill.exampleCount} observed attempt${skill.exampleCount===1?'':'s'} · ${skill.origin}`,'muted'));
  details.append(text('p',skill.assessment));
  if(skill.reusability)details.append(text('p',`${skill.reusability.source==='model'?'Model':'Local'} assessment · ${Math.round(skill.reusability.confidence*100)}% confidence · ${skill.reusability.reason}`,'muted'));
  if(skill.context)details.append(text('p',`Related task assumption: ${skill.context.intent} · ${Math.round(skill.context.confidence*100)}% confidence. ${skill.context.explanation} Task outcome is unverified.`,'muted'));
  const list=document.createElement('ol');
  for(const step of (skill.steps??[]).filter(step=>step?.target?.label?.trim() && ['click','change'].includes(step.kind))){list.append(text('li',`${step.kind==='change'?'Enter input for':'Click'} “${step.target?.label??'unknown target'}”${step.parameter?' · supplied each run':''}`));}
  if(list.children.length)details.append(list);
  if(!skill.needsExamples)details.append(text('p','Review the observed steps and supplied form inputs before repeating this task.','muted'));
  for(const example of skill.examples??[])details.append(text('p',`${new Date(example.at).toLocaleString()} · ${example.eventIds.length} cited actions`,'muted'));
  for(const blocker of skill.blockers)details.append(text('p',blocker,'blocker'));
  if(!saved){
    details.append(button('Save to skills',()=>request('save',{key:skill.key,title:nameInput.value}),true));
    details.append(button('Dismiss',()=>request('dismiss',{key:skill.key})));
  }
  else{
    if(!skill.active && !skill.blockers.length){
      const label=document.createElement('label'),review=document.createElement('input');review.type='checkbox';
      label.append(review,document.createTextNode(' I reviewed these steps and their effects.'));
      const activate=button('Activate skill',()=>request('activate',{id:skill.id,active:true,reviewed:review.checked}),true);
      activate.disabled=true;review.onchange=()=>{activate.disabled=!review.checked;};details.append(label,activate);
    }
    if(skill.active){
      const inputs={};
      for(const step of skill.steps.filter(step=>step.parameter)){
        const label=text('label',step.target.label),input=document.createElement('input');input.type='text';input.dataset.parameter='true';input.required=true;input.oninput=updateRunButtons;input.maxLength=200;input.autocomplete='off';input.placeholder=step.target.tag==='SELECT'?'Exact visible option label':'Value for this run';label.append(input);details.append(label);inputs[step.parameter]=input;
      }
      details.append(text('p','Open the same starting page on this site, then use Run from the extension toolbar. Review the result in the new tab.','muted'));
      const runButton=button('Run skill',()=>request('run',{id:skill.id,parameters:Object.fromEntries(Object.entries(inputs).map(([name,input])=>[name,input.value]))}),true);
      runButton.dataset.run='true';runButton.disabled=latest?.run?.status==='running';details.append(runButton);
      details.append(button('Deactivate',()=>request('activate',{id:skill.id,active:false})));
    }
    details.append(button('Delete skill',()=>request('delete',{id:skill.id})));
  }
  article.append(details);return article;
}
function render(value){
  latest=value;
  el('learning-status').textContent=value.recordingEnabled?'Recording is on · one useful completed attempt can become a skill.':'Learning is paused. Start learning before performing examples.';
  el('learning-toggle').textContent=value.recordingEnabled?'Pause learning':'Start learning';
  const pending=(value.learning??[]).filter(item=>!value.skills.some(skill=>!skill.needsExamples && skill.goalKey===item.goalKey) && !value.candidates.some(candidate=>candidate.goalKey===item.goalKey));
  el('learning-progress').replaceChildren(...(pending.length?pending.map(item=>{const node=document.createElement('article');node.append(text('strong',`${item.title} · ${item.observedExamples?'Attempt observed':'Waiting for result'}`),text('p',item.reason));return node;}):[text('p',value.recordingEnabled?'Waiting for a supported task result. Exports, downloads, previews and searches can be learned.':'No new examples are captured while paused.','muted')]));
  const history=value.history;el('task-history-info').textContent=history?`Current task: ${history.totalActions} actions retained locally · ${history.archivedTasks} archived tasks · ${history.retrievedEventIds?.length??0} older actions retrieved for the latest update.`:'Full action history is retained locally; model requests use a rolling summary and selected evidence.';
  const run=el('skills-run');run.hidden=!value.run;run.replaceChildren();
  if(value.run){
    run.append(text('strong',`${value.run.title} · ${value.run.status}`),text('p',`${value.run.completed} / ${value.run.total} steps dispatched. ${value.run.message??''}`));
    if(value.run.tabId)run.append(button('View run tab',async()=>{await chrome.tabs.update(value.run.tabId,{active:true});return latest;}));
    if(value.run.status==='running')run.append(button('Stop run',()=>request('cancel')));
  }
  const structure=JSON.stringify([value.skills,value.candidates]);
  if(structure!==lastStructure){
    const open=new Set([...root.querySelectorAll('details[open]')].map(node=>node.dataset.key));lastStructure=structure;
    const usable=value.skills.filter(skill=>!skill.needsExamples),legacy=value.skills.filter(skill=>skill.needsExamples);
    el('skills-library').replaceChildren(...(usable.length?usable.map(skill=>card(skill,true)):[text('p','No skills learned yet. Complete a supported workflow once; a reusable skill will be saved here.','muted')]));
    el('skills-legacy').replaceChildren(...legacy.map(skill=>card(skill,true)));
    el('skills-legacy-count').textContent=`Earlier skills needing new examples (${legacy.length})`;
    el('skills-legacy-count').parentElement.hidden=!legacy.length;
    const candidates=value.candidates.filter(candidate=>!value.skills.some(skill=>skill.key===candidate.key));
    el('skills-candidates').replaceChildren(...(candidates.length?candidates.map(skill=>card(skill,false)):[text('p','Useful workflows are saved under Your skills after their first supported attempt. Empty actions and overlapping fragments are excluded.','muted')]));
    for(const node of root.querySelectorAll('details'))if(open.has(node.dataset.key))node.open=true;
  }
  updateRunButtons();
}
function updateRunButtons(){
  for(const node of root.querySelectorAll('[data-run]'))node.disabled=latest?.run?.status==='running' || [...node.closest('article').querySelectorAll('[data-parameter]')].some(input=>!input.value.trim());
}
el('learning-toggle').onclick=()=>void act(async()=>{
  const result=await chrome.runtime.sendMessage({kind:latest?.recordingEnabled?'recording:pause':'recording:start'});
  if(!result?.ok)throw new Error(result?.error??'Recording did not respond.');
  return request('list');
});
el('skills-refresh').onclick=()=>void act(()=>request('list'));
if(location.protocol==='chrome-extension:' && globalThis.chrome?.runtime?.id){
  void act(()=>request('list'));
  setInterval(()=>{if(!busy)void request('list').then(render).catch(error=>{el('skills-error').textContent=error.message;});},2000);
}else el('skills-error').textContent='Open Skills from the installed extension toolbar.';
