import { readTaskActions } from './action-history.js';
import { analyzeSkills, riskyAction, validTarget, skillIssues, defaultSkillName, skillGoalKey } from './skill-learning.js';
const KEY='skillLibrary';
let queue=Promise.resolve();
let executing=false;
const serial=task=>{const next=queue.then(task);queue=next.catch(()=>{});return next;};
const library=async()=>((await chrome.storage.local.get(KEY))[KEY]??[]).map(skill=>{
  const blockers=skillIssues(skill);
  return {...skill,goalKey:validTarget(skill.steps?.at(-1)?.target)?skillGoalKey(skill.origin,skill.steps.at(-1).target):skill.goalKey,title:skill.customTitle?skill.title:defaultSkillName(skill.steps),blockers,active:skill.active===true && !blockers.length,needsExamples:blockers.length>0};
});
function skillName(value){
  if(typeof value!=='string' || !value.trim() || value.trim().length>80 || /[\u0000-\u001f]/.test(value))throw new Error('Enter a skill name from 1 to 80 characters.');
  return value.trim();
}
async function discovery(){
  const {fixtureRecording,contextBrain,brainConnection,dismissedSkillGoals=[]}=await chrome.storage.local.get(['fixtureRecording','contextBrain','brainConnection','dismissedSkillGoals']);
  const actions=await readTaskActions(contextBrain?.working?.openedAt??fixtureRecording?.startedAt);
  const value=analyzeSkills(actions.length?actions:fixtureRecording?.events??[],contextBrain?{...contextBrain,modelAvailable:!['unavailable','error'].includes(brainConnection?.status)}:null);
  return {candidates:value.candidates.filter(skill=>!dismissedSkillGoals.includes(skill.goalKey)),learning:value.learning.filter(skill=>!dismissedSkillGoals.includes(skill.goalKey))};
}
const candidates=async()=>(await discovery()).candidates;
async function state(){
  const {skillRun,recordingEnabled=false}=await chrome.storage.session.get(['skillRun','recordingEnabled']);
  const skills=await library(),value=await discovery();
  let learned=false;
  for(const candidate of value.candidates){
    if(skills.some(skill=>!skill.needsExamples && skill.goalKey===candidate.goalKey) || skills.filter(skill=>!skill.needsExamples).length>=30)continue;
    skills.push({...candidate,id:crypto.randomUUID(),active:false,learnedAutomatically:true,savedAt:new Date().toISOString()});learned=true;
  }
  if(learned)await chrome.storage.local.set({[KEY]:skills});
  const {contextBrain}=await chrome.storage.local.get('contextBrain');
  return {history:contextBrain?.history??null,skills,candidates:value.candidates.filter(candidate=>!skills.some(skill=>!skill.needsExamples && skill.goalKey===candidate.goalKey)),learning:value.learning,recordingEnabled,run:skillRun??null};
}
// Runs use declarative control descriptors. No generated scripts or stored CSS selectors execute.
function locate(target, parameter, origin, applySelection=false, verifyInput=false){
  if(location.origin!==origin)throw new Error('The page left the skill origin.');
  const label=control=>{
    const copy=control.cloneNode(true);copy.querySelectorAll('input,select,textarea,[data-sensitive],[contenteditable],script,style').forEach(node=>node.remove());
    return (control.getAttribute('aria-label') || (control.labels?[...control.labels].map(item=>{const node=item.cloneNode(true);node.querySelectorAll('input,select,textarea,[data-sensitive]').forEach(child=>child.remove());return node.textContent;}).join(' '):'') || (['BUTTON','A'].includes(control.tagName)?copy.textContent:'')).replace(/\s+/g,' ').trim().slice(0,100);
  };
  const matches=[...document.querySelectorAll('button,a,input,select,textarea')].filter(control=>control.tagName===target.tag && label(control)===target.label && (control.getAttribute('type') || (control.tagName==='BUTTON' && control.form?'submit':'')).toLowerCase()===target.type && control.getClientRects().length && getComputedStyle(control).visibility!=='hidden');
  if(matches.length!==1)throw new Error('Target missing or ambiguous. Open the same starting page and review the skill.');
  const control=matches[0];
  if(control.disabled || control.readOnly || control.closest('[data-sensitive],[contenteditable],[autocomplete^="cc-"],[autocomplete="current-password"],[autocomplete="new-password"]') || ['password','hidden','file','checkbox','radio'].includes(control.type))throw new Error('This control cannot be replayed safely.');
  if(control.tagName==='A' && (new URL(control.href).origin!==origin || control.target==='_blank'))throw new Error('Cross-origin or new-window links require manual action.');
  if(control.form && (target.type==='submit' || control.type==='submit') && (!/\b(export|download|search|filter)\b/i.test(target.label) || (control.form && new URL(control.form.action).origin!==origin)))throw new Error('Unsupported form submission.');
  if(verifyInput)return {matches:control.value===parameter};
  let optionIndex=null;
  if(parameter!==null && control.tagName==='SELECT'){
    const options=[...control.options].map((option,index)=>({option,index})).filter(({option})=>option.textContent.trim()===parameter && !option.disabled);
    if(options.length!==1)throw new Error('Enter the exact visible option label.');
    optionIndex=options[0].index;
    if(optionIndex>100)throw new Error('Selection exceeds replay limit.');
  }
  if(parameter!==null && control.tagName==='SELECT')control.focus();
  control.scrollIntoView({block:'center',inline:'center',behavior:'instant'});
  const rect=control.getBoundingClientRect(),x=rect.left+rect.width/2,y=rect.top+rect.height/2;
  const hit=document.elementFromPoint(x,y);
  if(!hit || !(hit===control || control.contains(hit)))throw new Error('The target is covered by another element.');
  if(applySelection){
    if(control.tagName!=='SELECT' || optionIndex===null)throw new Error('Invalid selection.');
    control.selectedIndex=optionIndex;
    control.dispatchEvent(new Event('input',{bubbles:true}));
    control.dispatchEvent(new Event('change',{bubbles:true}));
    if(control.selectedOptions[0]?.textContent.trim()!==parameter)throw new Error('The page did not retain the requested selection.');
  }
  return {x,y,optionIndex,tag:control.tagName};
}
async function update(run){await chrome.storage.session.set({skillRun:run});}
async function progress(run){await serial(async()=>{await assertRunning(run.id);await update(run);});}
async function assertRunning(id){const {skillRun}=await chrome.storage.session.get('skillRun');if(skillRun?.id!==id || skillRun.status!=='running')throw new Error('Run stopped.');}
async function pageResult(tabId){
  const value=await chrome.tabs.sendMessage(tabId,{kind:'recording:context-request'},{frameId:0});
  if(!value || typeof value.excerpt!=='string')throw new Error('The page result cannot be observed.');
  return JSON.stringify([value.title,value.headings,value.excerpt,value.submissionSequence??0]);
}
async function perform(skill,parameters,run,source){
  let attached=false;
  try{
    const tab=await chrome.tabs.create({url:source.url,active:true,windowId:source.windowId});
    run.tabId=tab.id;await progress(run);
    // Bounded navigation/readiness wait; no model calls or retries after an action.
    const deadline=Date.now()+15000;
    while((await chrome.tabs.get(tab.id)).status!=='complete'){
      await assertRunning(run.id);if(Date.now()>deadline)throw new Error('Starting page timed out.');
      await new Promise(resolve=>setTimeout(resolve,100));
    }
    await assertRunning(run.id);
    await chrome.debugger.attach({tabId:tab.id},'1.3');attached=true;
    const command=async(method,params={})=>{
      await assertRunning(run.id);
      const current=await chrome.tabs.get(tab.id);
      if(current.incognito || new URL(current.url).origin!==skill.origin)throw new Error('The run left its allowed origin.');
      return chrome.debugger.sendCommand({tabId:tab.id},method,params);
    };
    for(let index=0;index<skill.steps.length;index++){
      await assertRunning(run.id);
      const current=await chrome.tabs.get(tab.id);
      if(current.incognito || new URL(current.url).origin!==skill.origin)throw new Error('The run left its allowed origin.');
      const step=skill.steps[index],parameter=step.parameter?parameters[step.parameter]:null;
      const beforeResult=index===skill.steps.length-1?await pageResult(tab.id):null;
      if(!validTarget(step.target) || riskyAction.test(step.target.label) || !['click','change'].includes(step.kind))throw new Error('Unsupported skill step.');
      if(step.kind==='change' && (typeof parameter!=='string' || !parameter.trim() || parameter.length>200))throw new Error('Missing or invalid input parameter.');
      const results=await chrome.scripting.executeScript({target:{tabId:tab.id},func:locate,args:[step.target,parameter,skill.origin]});
      const point=results[0]?.result;
      if(!point)throw new Error(results[0]?.error?.message??'Target missing, ambiguous, covered, or unsupported. No action dispatched for this step.');
      await assertRunning(run.id);
      await chrome.storage.session.set({lastDispatch:{tabId:tab.id,at:Date.now()}});
      if(!(step.kind==='change' && point.tag==='SELECT')){
        await command('Input.dispatchMouseEvent',{type:'mousePressed',x:point.x,y:point.y,button:'left',clickCount:1});
        await command('Input.dispatchMouseEvent',{type:'mouseReleased',x:point.x,y:point.y,button:'left',clickCount:1});
      }
      if(step.kind==='change'){
        if(point.tag==='SELECT'){
          // Native select menus differ across OS/browser versions. A fixed, bounded
          // select adapter applies only the exact user-supplied option, then checks it.
          await assertRunning(run.id);
          const selected=await chrome.scripting.executeScript({target:{tabId:tab.id},func:locate,args:[step.target,parameter,skill.origin,true]});
          if(!selected[0]?.result)throw new Error('The requested option was not selected.');
        }else if(['INPUT','TEXTAREA'].includes(point.tag)){
          await command('Input.dispatchKeyEvent',{type:'keyDown',key:'a',code:'KeyA',modifiers:4,commands:['selectAll']});
          await command('Input.dispatchKeyEvent',{type:'keyUp',key:'a',code:'KeyA',modifiers:4});
          if(parameter)await command('Input.insertText',{text:parameter});
          else {await command('Input.dispatchKeyEvent',{type:'keyDown',key:'Backspace'});await command('Input.dispatchKeyEvent',{type:'keyUp',key:'Backspace'});}
          await command('Input.dispatchKeyEvent',{type:'keyDown',key:'Tab'});await command('Input.dispatchKeyEvent',{type:'keyUp',key:'Tab'});
          const checked=await chrome.scripting.executeScript({target:{tabId:tab.id},func:locate,args:[step.target,parameter,skill.origin,false,true]});
          if(checked[0]?.result?.matches!==true)throw new Error('The page did not retain the requested input.');
        }else throw new Error('Unsupported input control.');
      }
      await assertRunning(run.id);run.completed=index+1;await progress(run);
      await new Promise(resolve=>setTimeout(resolve,300));
      if(beforeResult!==null){
        let observed=false;
        for(let attempt=0;attempt<10;attempt++){
          await assertRunning(run.id);
          if(await pageResult(tab.id)!==beforeResult){observed=true;break;}
          await new Promise(resolve=>setTimeout(resolve,250));
        }
        if(!observed)throw new Error('The result action produced no observed page change or native form submission. Review the workflow before trying again.');
      }
    }
    await assertRunning(run.id);run.status='finished';run.message='The result action was observed. Check the page or downloaded artifact to confirm your task.';
  }catch(error){
    const {skillRun}=await chrome.storage.session.get('skillRun');
    run.status=skillRun?.status==='cancelled'?'cancelled':'failed';run.message=error.message;
  }finally{
    if(attached)await chrome.debugger.detach({tabId:run.tabId}).catch(()=>{});
    run.finishedAt=new Date().toISOString();
    await serial(async()=>{const {skillRun}=await chrome.storage.session.get('skillRun');if(skillRun?.id===run.id){if(skillRun.status==='cancelled'){run.status='cancelled';run.message=skillRun.message;}await update(run);}});
    executing=false;
  }
}
export function installSkills(){
  chrome.storage.onChanged.addListener((changes,area)=>{
    if(area==='local' && (changes.fixtureRecording || changes.contextBrain))void serial(()=>state()).catch(()=>{});
  });
  // A terminated worker must never automatically replay a partially completed run.
  void chrome.storage.session.get('skillRun').then(async({skillRun})=>{if(skillRun?.status==='running')await update({...skillRun,status:'interrupted',message:'The worker restarted. Review the page before starting another run.'});});
  chrome.runtime.onMessage.addListener((message,sender,respond)=>{
    if(sender.id!==chrome.runtime.id || !['popup.html','skills.html'].some(path=>sender.url===chrome.runtime.getURL(path)) || sender.tab?.incognito || !message?.kind?.startsWith('skills:'))return;
    serial(async()=>{
      if(message.kind==='skills:list')return state();
      const skills=await library();
      if(message.kind==='skills:save'){
        const candidate=(await candidates()).find(item=>item.key===message.key);
        if(!candidate)throw new Error('Evidence expired or changed. Refresh the suggestions.');
        if(skillIssues(candidate).length)throw new Error('This workflow has no complete, replayable actions.');
        if(!skills.some(item=>!item.needsExamples && item.goalKey===candidate.goalKey)){
          if(skills.filter(item=>!item.needsExamples).length>=30)throw new Error('The local library is full. Delete a skill first.');
          skills.push({...candidate,title:skillName(message.title??candidate.title),customTitle:message.title!==undefined,id:crypto.randomUUID(),active:false,savedAt:new Date().toISOString()});
          await chrome.storage.local.set({[KEY]:skills});
        }
      }else if(message.kind==='skills:rename'){
        const skill=skills.find(item=>item.id===message.id);if(!skill)throw new Error('Skill not found.');
        skill.title=skillName(message.title);skill.customTitle=true;await chrome.storage.local.set({[KEY]:skills});
      }else if(message.kind==='skills:dismiss'){
        const candidate=(await candidates()).find(item=>item.key===message.key);if(!candidate)throw new Error('Suggestion no longer available.');
        const {dismissedSkillGoals=[]}=await chrome.storage.local.get('dismissedSkillGoals');
        await chrome.storage.local.set({dismissedSkillGoals:[...new Set([...dismissedSkillGoals,candidate.goalKey])].slice(-100)});
      }else if(message.kind==='skills:activate' || message.kind==='skills:delete'){
        const skill=skills.find(item=>item.id===message.id);if(!skill)throw new Error('Skill not found.');
        if(message.kind==='skills:delete'){
          const {dismissedSkillGoals=[]}=await chrome.storage.local.get('dismissedSkillGoals');
          await chrome.storage.local.set({[KEY]:skills.filter(item=>item.id!==skill.id),dismissedSkillGoals:skill.goalKey?[...new Set([...dismissedSkillGoals,skill.goalKey])].slice(-100):dismissedSkillGoals});
        }
        else{
          if(message.active && skillIssues(skill).length)throw new Error('This skill has replay blockers.');
          if(message.active && message.reviewed!==true)throw new Error('Review the steps before activation.');
          skill.active=message.active===true;await chrome.storage.local.set({[KEY]:skills});
        }
      }else if(message.kind==='skills:run'){
        const skill=skills.find(item=>item.id===message.id);if(!skill?.active || skillIssues(skill).length)throw new Error('Activate a reviewed, replayable skill first.');
        const {skillRun,assigned}=await chrome.storage.session.get(['skillRun','assigned']);
        if(executing || skillRun?.status==='running' || assigned)throw new Error('Another run or debugger probe is active. Stop it first.');
        const [source]=await chrome.tabs.query({active:true,currentWindow:true});
        if(!source || source.incognito || !source.url || new URL(source.url).origin!==skill.origin)throw new Error('Open this skill’s starting page on its original site, then run from the extension toolbar.');
        const parameters=message.parameters??{};
        for(const step of skill.steps)if(step.parameter && (typeof parameters[step.parameter]!=='string' || !parameters[step.parameter].trim() || parameters[step.parameter].length>200))throw new Error('Fill in every input parameter.');
        const run={id:crypto.randomUUID(),skillId:skill.id,title:skill.title,status:'running',completed:0,total:skill.steps.length,startedAt:new Date().toISOString(),tabId:null};
        await update(run);executing=true;void perform(skill,parameters,run,source);
      }else if(message.kind==='skills:cancel'){
        const {skillRun}=await chrome.storage.session.get('skillRun');
        if(skillRun?.status==='running')await update({...skillRun,status:'cancelled',message:'Stopped. Already dispatched actions remain on the page.'});
      }else throw new Error('Unknown skill command.');
      return state();
    }).then(value=>respond({ok:true,value}),error=>respond({ok:false,error:error.message}));return true;
  });
}
