import { NETWORKING, discoverNetworking, networkingIssues } from './networking.ts';
import { gateRequest } from './skill-gate.ts';
import { currentVisualEvidence } from './visual-context.js';
import { attachSkillMemory, confirmSkillIntent } from './skill-memory.ts';
import { expectedFixtureCsv, watchFixtureExport } from './export-verification.js';
import { skillHelpPrompt } from './skill-help.js';
import { workflowSites, configureWorkflow } from './skill-workflow.js';
import { readSkillPage } from './skill-page.js';
import { readTaskActions } from './action-history.js';
import { analyzeSkills, riskyAction, validTarget, skillIssues, defaultSkillName, skillGoalKey, outcomeAction, probeTarget, repairSkill, demoSkill, demoSkills } from './skill-learning.js';
const KEY='skillLibrary';
let queue=Promise.resolve();
let executing=false;
const serial=task=>{const next=queue.then(task);queue=next.catch(()=>{});return next;};
const library=async()=>((await chrome.storage.local.get(KEY))[KEY]??[]).map(skill=>{
  const blockers=skill.family===NETWORKING?networkingIssues(skill):skillIssues(skill);
  if(skill.family===NETWORKING)return {...skill,blockers,active:false,needsVerifier:true,needsExamples:blockers.length>0};
  return {...skill,goalKey:validTarget(skill.steps?.at(-1)?.target)?skillGoalKey(skill.origin,skill.steps.at(-1).target):skill.goalKey,title:skill.customTitle?skill.title:defaultSkillName(skill.steps),blockers,active:skill.active===true && skill.approval?.verdict==='approved' && !blockers.length,needsExamples:blockers.length>0};
});
function skillName(value){
  if(typeof value!=='string' || !value.trim() || value.trim().length>80 || /[\u0000-\u001f]/.test(value))throw new Error('Enter a skill name from 1 to 80 characters.');
  return value.trim();
}
async function discovery(){
  const {fixtureRecording,contextBrain,brainConnection,dismissedSkillGoals=[],skillWebsiteStarts={}}=await chrome.storage.local.get(['fixtureRecording','contextBrain','brainConnection','dismissedSkillGoals','skillWebsiteStarts']);
  const actions=await readTaskActions(contextBrain?.working?.openedAt??fixtureRecording?.startedAt);
  const value=analyzeSkills(actions.length?actions:fixtureRecording?.events??[],contextBrain?{...contextBrain,modelAvailable:!['unavailable','error'].includes(brainConnection?.status)}:null);
  value.candidates.push(...discoverNetworking(actions.length?actions:fixtureRecording?.events??[],skillWebsiteStarts,await chrome.tabs.query({})));
  for(const candidate of value.candidates){
    const sourceEvents=actions.length?actions:fixtureRecording?.events??[];
    attachSkillMemory(candidate,sourceEvents,currentVisualEvidence());
    const first=sourceEvents.find(event=>candidate.evidenceIds.includes(event.id));
    const url=first?skillWebsiteStarts[`${first.sessionId}:${first.tabId}:${first.origin}`]:null;
    if(candidate.family!==NETWORKING && url && new URL(url).origin===candidate.origin)candidate.sites=[{id:'main',url}];
  }
  return {candidates:value.candidates.filter(skill=>!dismissedSkillGoals.includes(skill.goalKey)),learning:value.learning.map(item=>({...item,dismissed:dismissedSkillGoals.includes(item.goalKey)}))};
}
const candidates=async()=>(await discovery()).candidates;
async function state(){
  const {skillRun,recordingEnabled=false}=await chrome.storage.session.get(['skillRun','recordingEnabled']);
  const skills=await library(),value=await discovery();
  const {contextBrain}=await chrome.storage.local.get('contextBrain');
  return {history:contextBrain?.history??null,skills,candidates:value.candidates.filter(candidate=>!skills.some(skill=>!skill.needsExamples && skill.goalKey===candidate.goalKey)),learning:value.learning.map(item=>{const saved=skills.find(skill=>!skill.needsExamples && skill.goalKey===item.goalKey);return {...item,status:saved?'saved':item.dismissed?'dismissed':item.blocked?'blocked':value.candidates.some(candidate=>candidate.goalKey===item.goalKey)?'needs_intent':'observing',reason:saved?'Saved from the first supported attempt. Review and activate it in the skills library.':item.dismissed?'You dismissed this workflow.':value.candidates.some(candidate=>candidate.goalKey===item.goalKey)?'What should this skill accomplish? Add its intent to save it.':item.reason};}),recordingEnabled,run:skillRun??null};
}
// Runs use declarative control descriptors. No generated scripts or stored CSS selectors execute.
function locate(target, parameter, origin, applySelection=false, verifyInput=false){
  if(location.origin!==origin)throw new Error('The page left the skill origin.');
  const label=control=>{
    const copy=control.cloneNode(true);copy.querySelectorAll('input,select,textarea,[data-sensitive],[contenteditable],script,style').forEach(node=>node.remove());
    return (control.getAttribute('aria-label') || (control.labels?[...control.labels].map(item=>{const node=item.cloneNode(true);node.querySelectorAll('input,select,textarea,[data-sensitive]').forEach(child=>child.remove());return node.textContent;}).join(' '):'') || control.getAttribute('placeholder') || (['BUTTON','A'].includes(control.tagName)?copy.textContent:'')).replace(/\s+/g,' ').trim().slice(0,100);
  };
  const matches=[...document.querySelectorAll('button,a,input,select,textarea')].filter(control=>control.tagName===target.tag && label(control)===target.label && (control.getAttribute('type') || (control.tagName==='BUTTON' && control.form?'submit':'')).toLowerCase()===target.type && control.getClientRects().length && getComputedStyle(control).visibility!=='hidden');
  if(matches.length!==1)throw new Error('Target missing or ambiguous. Open the same starting page and review the skill.');
  const control=matches[0];
  if(control.disabled || control.readOnly || control.closest('[data-cobrowser-probe],[data-cobrowser-agent],[data-sensitive],[contenteditable],[autocomplete^="cc-"],[autocomplete="current-password"],[autocomplete="new-password"]') || ['password','hidden','file','checkbox','radio'].includes(control.type))throw new Error('This control cannot be replayed safely.');
  if(control.tagName==='A' && (new URL(control.href).origin!==origin || control.target==='_blank'))throw new Error('Cross-origin or new-window links require manual action.');
  if(control.form && (target.type==='submit' || control.type==='submit') && (!/\b(export|download|search|filter)\b/i.test(target.label) || (control.form && new URL(control.form.action).origin!==origin)))throw new Error('Unsupported form submission.');
  if(verifyInput)return {matches:control.tagName==='SELECT'?control.selectedOptions[0]?.textContent.trim()===parameter:control.value===parameter};
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
  if(applySelection)throw new Error('Selection requires browser input.');
  return {x,y,optionIndex,tag:control.tagName};
}
async function update(run){await chrome.storage.session.set({skillRun:run});}
async function progress(run){await serial(async()=>{await assertRunning(run.id);await update(run);});}
async function assertRunning(id){const {skillRun}=await chrome.storage.session.get('skillRun');if(skillRun?.id!==id || !['running','needs_input'].includes(skillRun.status))throw new Error('Run stopped.');}
async function pageResult(tabId){
  const value=await chrome.tabs.sendMessage(tabId,{kind:'recording:context-request'},{frameId:0});
  if(!value || typeof value.excerpt!=='string')throw new Error('The page result cannot be observed.');
  return JSON.stringify([value.title,value.headings,value.excerpt,value.submissionSequence??0]);
}
async function waitForPage(tabId,run){
  const deadline=Date.now()+15000;
  while((await chrome.tabs.get(tabId)).status!=='complete'){
    await assertRunning(run.id);if(Date.now()>deadline)throw new Error('A required website timed out.');
    await new Promise(resolve=>setTimeout(resolve,100));
  }
}
async function checkSite(tabId,site){
  const tab=await chrome.tabs.get(tabId);
  if(tab.incognito || new URL(tab.url).origin!==new URL(site.url).origin)throw new Error('A website left its configured origin. Update the website address if it redirects to another site.');
  return tab;
}
async function readPages(tabs,sites,run){
  const pages=[];
  for(const site of sites){
    await assertRunning(run.id);const tabId=tabs.get(site.id);await checkSite(tabId,site);
    const results=await chrome.scripting.executeScript({target:{tabId},func:readSkillPage});
    const page=results[0]?.result;
    if(!page || page.origin!==new URL(site.url).origin)throw new Error('A required page could not be read.');
    pages.push({siteId:site.id,...page});
  }
  return pages;
}
async function askForHelp(run,question,issue=null,input=null){
  await assertRunning(run.id);
  if(run.answers.length>=12)throw new Error('This run needs too many clarifications. Refine the instruction before starting again.');
  run.status='needs_input';run.question=question.slice(0,500);run.helpToken=crypto.randomUUID();run.issue=issue;run.pendingInput=input;
  run.message=issue?.kind==='provider'?'Input provider unavailable. Completed steps are preserved. Enter an exact value to continue without the model.':issue?'Paused for help with a workflow issue.':'One detail is needed to continue.';await progress(run);
  const tabId=run.tabId??run.tabIds.at(-1);
  const prompt=()=>({runId:run.id,token:run.helpToken,title:run.title,question:run.question,input:run.pendingInput,invalidOutput:run.issue?.kind==='invalid-output',providerFailure:['provider','invalid-output'].includes(run.issue?.kind)});
  try{
    await chrome.tabs.update(tabId,{active:true});
    await chrome.scripting.executeScript({target:{tabId},func:skillHelpPrompt,args:[prompt()]});
  }catch{
    run.message+=' This page cannot show the prompt; answer in the Skills library.';await progress(run);
  }
  try{
    let refreshedAt=Date.now();
    while(true){
      await new Promise(resolve=>setTimeout(resolve,250));await assertRunning(run.id);
      const {skillRun}=await chrome.storage.session.get('skillRun');
      if(skillRun.status==='running'){
        const reply=skillRun.inputReply;run.answers=skillRun.answers;run.status='running';run.question=null;run.helpToken=null;run.issue=null;run.pendingInput=null;delete run.inputReply;return reply;
      }
      if(tabId && Date.now()-refreshedAt>1000){refreshedAt=Date.now();await chrome.scripting.executeScript({target:{tabId},func:skillHelpPrompt,args:[prompt()]}).catch(()=>{});}
    }
  }finally{
    if(tabId)await chrome.scripting.executeScript({target:{tabId},func:skillHelpPrompt,args:[null]}).catch(()=>{});
  }
}
// Retries cover only read-only input planning, never browser action dispatch.
export async function requestInputWithRetries(message,{send,onRetry,check=async()=>{},wait=ms=>new Promise(resolve=>setTimeout(resolve,ms))}){
  for(let attempt=1;attempt<=3;attempt++){
    await check();
    let response,code;
    try{response=await send(message);}catch{code='skill-native-host-unavailable';}
    await check();
    if(response?.kind==='skill-input-result' && response.seq===message.seq){
      const decision=response.decision;
      if(!message.target || (decision && Array.isArray(decision.sourceSiteIds) && decision.sourceSiteIds.every(id=>message.pages.some(page=>page.siteId===id)) &&
        (decision.status==='resolved'?typeof decision.value==='string' && decision.value.length<=2000 && (message.target.tag!=='SELECT' || message.options.includes(decision.value)):
          decision.status==='needs_input' && typeof decision.question==='string' && decision.question.trim() && decision.question.length<=500)))return response;
      code='skill-provider-invalid-output';
    }
    code??=typeof response?.code==='string' && /^[a-z0-9-]{1,100}$/.test(response.code)?response.code:'skill-provider-invalid-response';
    const transient=/native-host-unavailable|network-or-timeout|response-read-failed|http-(408|429|5[0-9]{2})$/.test(code);
    if(transient && attempt<3){await onRetry({attempt:attempt+1,total:3,code});await wait(500*attempt);continue;}
    throw Object.assign(new Error(code),{providerFailure:true,issueKind:/invalid|envelope|content|output|json/.test(code)?'invalid-output':'provider',attempts:attempt});
  }
}
export function exactInputValue(value,input){
  if(typeof value!=='string' || value.length>2000)throw new Error('Enter an exact value of at most 2,000 characters.');
  if(input.tag==='SELECT' && !input.options.includes(value))throw new Error('Choose an exact available option label.');
  return value;
}
async function withHelp(run,task,question){
  for(let attempt=0;attempt<4;attempt++){
    await assertRunning(run.id);
    try{return await task();}catch(error){
      await assertRunning(run.id);
      if(attempt===3)throw error;
      if(attempt<2){
        run.message=`Rechecking the page (${attempt+2} / 3): ${error.message}`;await progress(run);
        await new Promise(resolve=>setTimeout(resolve,500*(attempt+1)));
        continue;
      }
      await askForHelp(run,`${error.message} ${question}`,error.message);
    }
  }
}
async function resolveParameter(skill,step,index,tabs,sites,run){
  if(!run.instruction?.trim())throw new Error('Describe what this run should do, or supply optional input overrides.');
  for(let attempt=0;attempt<4;attempt++){
    const pages=await readPages(tabs,sites,run);
    const current=pages.find(page=>page.siteId===(step.siteId??'main'));
    const control=current.controls.find(item=>JSON.stringify(item.target)===JSON.stringify(step.target));
    if(!control)throw new Error('The required field is missing. Review the skill steps.');
    run.message=`Choosing an input for “${step.target.label}” from your instruction and listed websites…`;await progress(run);
    const message={v:1,kind:'skill-input',seq:index*10+attempt+1,instruction:run.instruction,at:new Date().toISOString(),timezone:Intl.DateTimeFormat().resolvedOptions().timeZone,
      skill:{title:skill.title,step:index,total:skill.steps.length},target:step.target,options:control.options,
      pages:pages.map(({controls:_controls,...page})=>page),answers:run.answers,previousInputs:(run.resolvedInputs??[]).map(input=>({...input}))};
    let response;
    const input={step:index,parameter:step.parameter,label:step.target.label,tag:step.target.tag,options:control.options};
    try{
      response=await requestInputWithRetries(message,{
        send:value=>chrome.runtime.sendNativeMessage('com.cobrowser.context',value),check:()=>assertRunning(run.id),
        onRetry:async retry=>{run.retry=retry;run.message=`Input provider temporarily unavailable (${retry.code}). Retrying ${retry.attempt} / ${retry.total} for “${step.target.label}”… No action dispatched.`;await progress(run);}
      });
      run.retry=null;
    }catch(error){
      if(!error.providerFailure)throw error;
      run.retry=null;
      const reply=await askForHelp(run,`Input provider unavailable (${error.message}) after ${error.attempts} attempt(s). No input was dispatched for “${step.target.label}”. Supply its exact value to continue without a model call.`,{kind:error.issueKind??'provider',code:error.message},input);
      if(reply?.mode==='value'){
        run.decisions.push({step:index,label:step.target.label,explanation:'Exact value supplied by you; no model call.',sourceSiteIds:[]});
        return exactInputValue(reply.value,input);
      }
      throw new Error('Supply an exact field value to continue without the unavailable provider.');
    }
    const decision=response.decision;
    if(!decision || !Array.isArray(decision.sourceSiteIds) || decision.sourceSiteIds.some(id=>!sites.some(site=>site.id===id)))throw new Error('Input reasoning returned invalid evidence.');
    if(decision.status==='resolved'){
      if(typeof decision.value!=='string' || decision.value.length>2000 || (step.target.tag==='SELECT' && !control.options.includes(decision.value)))throw new Error('Input reasoning returned an unsupported value.');
      run.decisions.push({step:index,label:step.target.label,explanation:decision.explanation,sourceSiteIds:decision.sourceSiteIds});
      return decision.value;
    }
    if(decision.status!=='needs_input' || typeof decision.question!=='string' || !decision.question.trim() || decision.question.length>500)throw new Error('Input reasoning returned an invalid question.');
    const reply=await askForHelp(run,decision.question,null,input);
    if(reply?.mode==='value'){
      run.decisions.push({step:index,label:step.target.label,explanation:'Exact value supplied by you; no model call.',sourceSiteIds:[]});
      return exactInputValue(reply.value,input);
    }
  }
  throw new Error('The field remains ambiguous. Refine the instruction and source websites.');
}
async function approvedRun(skill,run){
  await assertRunning(run.id);
  await gateRequest('check',skill,{runId:run.id,step:run.completed});
}
async function revokeApproval(skill){
  if(skill.family===NETWORKING){skill.active=false;delete skill.networkingReview;return;}
  // Local state always becomes inactive, even when the host is offline.
  skill.active=false;delete skill.approval;delete skill.verificationTask;
  await gateRequest('deactivate',skill).catch(()=>{});
}
async function perform(skill,parameters,run,windowId){
  const attached=new Set(),tabs=new Map(),sites=workflowSites(skill),verifiers=[];
  try{
    for(const site of sites){
      await approvedRun(skill,run);
      const tab=await chrome.tabs.create({url:site.url,active:false,windowId});tabs.set(site.id,tab.id);run.tabIds.push(tab.id);await progress(run);
      run.tabId=tab.id;
      const {automationTabIds=[]}=await chrome.storage.session.get('automationTabIds');
      await chrome.storage.session.set({automationTabIds:[...new Set([...automationTabIds,tab.id])]});
      await withHelp(run,async()=>{await waitForPage(tab.id,run);await checkSite(tab.id,site);},'Fix or finish loading the configured page, then tell me what changed.');
    }
    run.resolvedInputs=[];
    for(let index=0;index<skill.steps.length;index++){
      await approvedRun(skill,run);
      const step=skill.steps[index],site=sites.find(item=>item.id===(step.siteId??'main'));
      if(!site)throw new Error('A step has no configured website.');
      const tabId=tabs.get(site.id);run.tabId=tabId;run.currentSite=site.url;await progress(run);
      if(!validTarget(step.target) || probeTarget(step.target) || riskyAction.test(step.target.label) || !['click','change'].includes(step.kind))throw new Error('Unsupported skill step.');
      const origin=new URL(site.url).origin;
      let resolvedParameter=Object.hasOwn(parameters,step.parameter)?parameters[step.parameter]:undefined;
      const prepared=await withHelp(run,async()=>{
        await waitForPage(tabId,run);await checkSite(tabId,site);await chrome.tabs.update(tabId,{active:true});
        if(!attached.has(tabId)){await chrome.debugger.attach({tabId},'1.3');attached.add(tabId);}
        let parameter=null;
        if(step.kind==='change'){
          resolvedParameter??=await resolveParameter(skill,step,index,tabs,sites,run);
          parameter=resolvedParameter;
          if(typeof parameter!=='string' || parameter.length>2000)throw new Error('Invalid input value.');
        }
        const beforeResult=outcomeAction(step)?await pageResult(tabId):null;
        const results=await chrome.scripting.executeScript({target:{tabId},func:locate,args:[step.target,parameter,origin]});
        const point=results[0]?.result;
        if(!point)throw new Error(results[0]?.error?.message??'Target missing, ambiguous, covered, or unsupported. No action dispatched for this step.');
        return {parameter,beforeResult,point};
      },`No action has been dispatched for this step. Fix the page or provide the missing detail for “${step.target.label}”, then continue.`);
      const {parameter,beforeResult,point}=prepared;
      if(step.target.label==='Export CSV' && outcomeAction(step) && new URL(origin).hostname==='127.0.0.1'){
        const title=await chrome.tabs.get(tabId);
        const explicit=Object.fromEntries(skill.steps.filter(item=>item.kind==='change' && Object.hasOwn(parameters,item.parameter)).map(item=>[item.target.label,parameters[item.parameter]]));
        const expected=expectedFixtureCsv(explicit);
        if(title.title==='Harness fixture phase0-agent-7f3a91' && expected!==null)verifiers.push(await watchFixtureExport(tabId,origin,expected));
      }

      const command=async(method,params={})=>{await approvedRun(skill,run);await checkSite(tabId,site);return chrome.debugger.sendCommand({tabId},method,params);};
      await assertRunning(run.id);await checkSite(tabId,site);
      await chrome.storage.session.set({lastDispatch:{tabId,at:Date.now()}});
      try{
      if(!(step.kind==='change' && point.tag==='SELECT')){
        await command('Input.dispatchMouseEvent',{type:'mousePressed',x:point.x,y:point.y,button:'left',clickCount:1});
        await command('Input.dispatchMouseEvent',{type:'mouseReleased',x:point.x,y:point.y,button:'left',clickCount:1});
      }
      if(step.kind==='change'){
        if(point.tag==='SELECT'){
          await approvedRun(skill,run);await checkSite(tabId,site);
          const key=parameter[0];
          await command('Input.dispatchKeyEvent',{type:'keyDown',key,text:key,unmodifiedText:key});
          await command('Input.dispatchKeyEvent',{type:'keyUp',key});
          await command('Input.dispatchKeyEvent',{type:'keyDown',key:'Tab'});await command('Input.dispatchKeyEvent',{type:'keyUp',key:'Tab'});
          const selected=await chrome.scripting.executeScript({target:{tabId},func:locate,args:[step.target,parameter,origin,false,true]});
          if(selected[0]?.result?.matches!==true)throw new Error('The requested option was not selected.');
        }else if(['INPUT','TEXTAREA'].includes(point.tag)){
          await command('Input.dispatchKeyEvent',{type:'keyDown',key:'a',code:'KeyA',modifiers:4,commands:['selectAll']});
          await command('Input.dispatchKeyEvent',{type:'keyUp',key:'a',code:'KeyA',modifiers:4});
          if(parameter)await command('Input.insertText',{text:parameter});
          else {await command('Input.dispatchKeyEvent',{type:'keyDown',key:'Backspace'});await command('Input.dispatchKeyEvent',{type:'keyUp',key:'Backspace'});}
          await command('Input.dispatchKeyEvent',{type:'keyDown',key:'Tab'});await command('Input.dispatchKeyEvent',{type:'keyUp',key:'Tab'});
          const checked=await chrome.scripting.executeScript({target:{tabId},func:locate,args:[step.target,parameter,origin,false,true]});
          if(checked[0]?.result?.matches!==true)await withHelp(run,async()=>{const result=await chrome.scripting.executeScript({target:{tabId},func:locate,args:[step.target,parameter,origin,false,true]});if(result[0]?.result?.matches!==true)throw new Error('The page did not retain the requested input.');},'The input was already dispatched. Correct the field on the page, then describe the fix. It will be checked without repeating the action.');
        }else throw new Error('Unsupported input control.');
      }
      }catch(error){
        if(error.gateFailure)throw error;
        await assertRunning(run.id);
        await askForHelp(run,`${error.message} Some input may already have reached the page. Complete this step manually and describe what you did; the skill will continue without repeating it.`,error.message);
        await withHelp(run,async()=>{
          await checkSite(tabId,site);
          if(step.kind==='change'){
            const checked=await chrome.scripting.executeScript({target:{tabId},func:locate,args:[step.target,parameter,origin,false,true]});
            if(checked[0]?.result?.matches!==true)throw new Error('The field still does not match the requested input.');
          }
        },'Fix the page to match this step, then describe the change. No action will be repeated.');
      }
      if(step.kind==='change')run.resolvedInputs.push({label:step.target.label,value:parameter});
      await assertRunning(run.id);run.completed=index+1;run.message=`Completed “${step.target.label}”.`;await progress(run);
      await new Promise(resolve=>setTimeout(resolve,300));
      if(beforeResult!==null){
        await withHelp(run,async()=>{
          for(let attempt=0;attempt<10;attempt++){
            await assertRunning(run.id);await checkSite(tabId,site);
            if(await pageResult(tabId)!==beforeResult)return;
            await new Promise(resolve=>setTimeout(resolve,250));
          }
          throw new Error('The result action produced no observed page change or native form submission.');
        },'The action was already dispatched and will not be repeated. Fix or finish the result on the page, then describe what changed.');
      }
    }
    await approvedRun(skill,run);
    for(const verifier of verifiers){
      for(let attempt=0;attempt<40 && !verifier.result();attempt++){await assertRunning(run.id);await new Promise(resolve=>setTimeout(resolve,100));}
    }
    run.verification=verifiers.length?verifiers.map(item=>item.result()??{status:'failed',message:'No export response observed.'}):[{status:'unverified',message:'Actions finished; no independent result verifier applies.'}];
    run.status=run.verification.some(item=>item.status==='failed')?'failed':'finished';run.message=run.verification.every(item=>item.status==='verified')?'Actions finished. Synthetic fixture CSV response verified against explicit overrides.':run.verification.some(item=>item.status==='failed')?'Actions finished. Export result verification failed.':'Actions finished. Result unverified; inspect the pages or downloaded artifacts.';
  }catch(error){
    const {skillRun}=await chrome.storage.session.get('skillRun');
    run.status=skillRun?.status==='cancelled'?'cancelled':'failed';run.message=error.message;
  }finally{
    await gateRequest('finish',skill,{runId:run.id,status:run.status==='cancelled'?'cancelled':run.status==='finished'?'finished':'failed'}).catch(()=>{});
    for(const verifier of verifiers)await verifier.close();
    for(const tabId of attached)await chrome.debugger.detach({tabId}).catch(()=>{});
    run.finishedAt=new Date().toISOString();run.question=null;run.helpToken=null;run.issue=null;run.pendingInput=null;run.retry=null;delete run.inputReply;
    for(const tabId of run.tabIds)await chrome.scripting.executeScript({target:{tabId},func:skillHelpPrompt,args:[null]}).catch(()=>{});
    // Instructions/answers may contain task data; keep them only during this run.
    delete run.answers;delete run.instruction;delete run.resolvedInputs;
    await serial(async()=>{const {skillRun}=await chrome.storage.session.get('skillRun');if(skillRun?.id===run.id){if(skillRun.status==='cancelled'){run.status='cancelled';run.message=skillRun.message;}await update(run);}});
    executing=false;
  }
}
export function installSkills(){
  chrome.storage.onChanged.addListener((changes,area)=>{
    if(area==='local' && (changes.fixtureRecording || changes.contextBrain))void serial(()=>state()).catch(()=>{});
  });
  // A terminated worker must never automatically replay a partially completed run.
  void chrome.storage.session.get('skillRun').then(async({skillRun})=>{
    if(!['running','needs_input'].includes(skillRun?.status))return;
    const interruptedSkill=(await library()).find(skill=>skill.id===skillRun.skillId);
    if(interruptedSkill)await gateRequest('finish',interruptedSkill,{runId:skillRun.id,status:'failed'}).catch(()=>{});
    delete skillRun.instruction;delete skillRun.answers;delete skillRun.inputReply;
    await update({...skillRun,status:'interrupted',question:null,helpToken:null,pendingInput:null,issue:null,retry:null,message:'The worker restarted. Review the page before starting another run. Completed actions will not be replayed automatically.'});
  });
  chrome.runtime.onMessage.addListener((message,sender,respond)=>{
    if(sender.id!==chrome.runtime.id || sender.tab?.incognito || !message?.kind?.startsWith('skills:'))return;
    const isMonitor=sender.url===chrome.runtime.getURL('recording.html') && message.kind==='skills:list';
    const isView=isMonitor || ['popup.html','skills.html'].some(path=>sender.url===chrome.runtime.getURL(path));
    const isHelp=sender.tab && sender.frameId===0 && ['skills:answer','skills:cancel','skills:help-status'].includes(message.kind);
    if(!isView && !isHelp)return;
    serial(async()=>{
      if(!isView){
        const {skillRun}=await chrome.storage.session.get('skillRun');
        if(skillRun?.status!=='needs_input' || skillRun.id!==message.runId || skillRun.helpToken!==message.helpToken || sender.tab.id!==skillRun.tabId)throw new Error('This help request is no longer active.');
      }
      if(message.kind==='skills:help-status')return {waiting:true};
      if(message.kind==='skills:list')return state();
      const skills=await library();
      if((message.kind==='skills:run'||(message.kind==='skills:activate'&&message.active))&&skills.find(skill=>skill.id===message.id)?.family===NETWORKING)throw new Error('Networking requires independent verification before activation or execution. No supported verifier is available yet.');
      if(message.kind==='skills:save'){
        const candidate=(await candidates()).find(item=>item.key===message.key);
        if(!candidate)throw new Error('Evidence expired or changed. Refresh the suggestions.');
        if((candidate.family===NETWORKING?networkingIssues(candidate):skillIssues(candidate)).length)throw new Error('This workflow has no complete, replayable actions.');
        if(!skills.some(item=>!item.needsExamples && item.goalKey===candidate.goalKey)){
          if(skills.filter(item=>!item.needsExamples).length>=30)throw new Error('The local library is full. Delete a skill first.');
          skills.push({...confirmSkillIntent(candidate,message.intent),title:skillName(message.title??candidate.title),customTitle:message.title!==undefined,id:crypto.randomUUID(),active:false,savedAt:new Date().toISOString()});
          await chrome.storage.local.set({[KEY]:skills});
        }
      }else if(message.kind==='skills:seed-demo'){
        const seeds=[demoSkill(),...demoSkills()];
        if(seeds.some(seed=>skillIssues(seed).length))throw new Error('A built-in skill is invalid.');
        let added=false;
        for(const seed of seeds){
          if(skills.some(item=>item.goalKey===seed.goalKey))continue;
          if(skills.filter(item=>!item.needsExamples).length>=30)throw new Error('The local library is full. Delete a skill first.');
          skills.push({...seed,id:crypto.randomUUID(),savedAt:new Date().toISOString()});added=true;
        }
        if(added)await chrome.storage.local.set({[KEY]:skills});
      }else if(message.kind==='skills:configure'){
        const skill=skills.find(item=>item.id===message.id);if(!skill)throw new Error('Skill not found.');
        if(skill.family===NETWORKING)throw new Error('Networking recipes keep their learned guest-list address. Demonstrate another guest list to learn a new recipe.');
        const addition=message.appendSkillId?skills.find(item=>item.id===message.appendSkillId):null;
        if(message.appendSkillId && (!addition || addition.needsExamples || addition.id===skill.id))throw new Error('Choose another supported skill to append.');
        const configured=configureWorkflow(skill,message.urls,message.instruction,addition);
        if(skillIssues(configured).length)throw new Error('The combined workflow has unsupported steps.');
        await revokeApproval(skill);delete configured.approval;delete configured.verificationTask;
        skills[skills.indexOf(skill)]=configured;await chrome.storage.local.set({[KEY]:skills});
      }else if(message.kind==='skills:repair'){
        const skill=skills.find(item=>item.id===message.id);if(!skill)throw new Error('Skill not found.');
        if(skill.family===NETWORKING)throw new Error('Networking recipes cannot be repaired as recorded click steps.');
        const {skillRun}=await chrome.storage.session.get('skillRun');
        if(['running','needs_input'].includes(skillRun?.status) && skillRun.skillId===skill.id)throw new Error('Stop this run before repairing its saved steps.');
        await revokeApproval(skill);
        skills[skills.indexOf(skill)]=repairSkill(skill,message.removeSteps);
        await chrome.storage.local.set({[KEY]:skills});
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
          await revokeApproval(skill);
          const {dismissedSkillGoals=[]}=await chrome.storage.local.get('dismissedSkillGoals');
          await chrome.storage.local.set({[KEY]:skills.filter(item=>item.id!==skill.id),dismissedSkillGoals:skill.goalKey?[...new Set([...dismissedSkillGoals,skill.goalKey])].slice(-100):dismissedSkillGoals});
        }
        else{
          if(message.active && (skill.family===NETWORKING?networkingIssues(skill):skillIssues(skill)).length)throw new Error('This skill has replay blockers.');
          if(message.active && message.reviewed!==true)throw new Error('Review the steps before activation.');
          if(message.active){
            if(!message.verificationTask)throw new Error('Choose the independent verification task before activation. Only the synthetic weekly report is supported.');
            const verification=await gateRequest('activate',skill,{task:message.verificationTask,reviewed:true});
            skill.approval=verification.approval;skill.verificationTask=verification.task??message.verificationTask;skill.active=verification.status==='approved';
            await chrome.storage.local.set({[KEY]:skills});
            if(!skill.active)throw new Error(verification.message??'Independent verification did not approve this workflow.');
          }else{await revokeApproval(skill);await chrome.storage.local.set({[KEY]:skills});}
        }
      }else if(message.kind==='skills:run'){
        const skill=skills.find(item=>item.id===message.id);if(!skill?.active || (skill.family===NETWORKING?networkingIssues(skill):skillIssues(skill)).length)throw new Error('Activate a reviewed, replayable skill first.');
        const {skillRun,assigned}=await chrome.storage.session.get(['skillRun','assigned']);
        if(executing || ['running','needs_input'].includes(skillRun?.status) || assigned)throw new Error('Another run or debugger probe is active. Stop it first.');
        const sites=workflowSites(skill);
        if(skill.steps.some(step=>!sites.some(site=>site.id===(step.siteId??'main'))))throw new Error('Configure each step’s website first.');
        const parameters=message.parameters??{};
        if(typeof parameters!=='object' || Array.isArray(parameters) || Object.values(parameters).some(value=>typeof value!=='string' || value.length>2000))throw new Error('Invalid input overrides.');
        const instruction=message.instruction??skill.instruction??'';
        if(typeof instruction!=='string' || instruction.length>4000)throw new Error('Keep the instruction under 4,000 characters.');
        const window=await chrome.windows.getCurrent();
        if(window.incognito)throw new Error('Skills cannot run in an incognito window.');
        const run={id:crypto.randomUUID(),skillId:skill.id,title:skill.title,status:'running',completed:0,total:skill.steps.length,startedAt:new Date().toISOString(),tabId:null,tabIds:[],instruction,answers:[],decisions:[]};
        const authorization=await gateRequest('begin',skill,{runId:run.id,parameters,instruction});
        run.approvedCandidateHash=authorization.candidateHash;
        await update(run);executing=true;void perform(skill,authorization.parameters,run,window.id);
      }else if(message.kind==='skills:answer'){
        const {skillRun}=await chrome.storage.session.get('skillRun');
        if(skillRun?.status!=='needs_input' || message.runId!==skillRun.id)throw new Error('This run is no longer waiting for an answer.');
        if(message.helpToken!==skillRun.helpToken)throw new Error('This help prompt has expired.');
        if(message.mode==='value'){
          if(!skillRun.pendingInput)throw new Error('This pause is not waiting for a field value.');
          const value=exactInputValue(message.value,skillRun.pendingInput);
          await update({...skillRun,status:'running',question:null,inputReply:{mode:'value',value}});
        }else{
          if(['provider','invalid-output'].includes(skillRun.issue?.kind))throw new Error('The provider is unavailable. Supply an exact field value; a clarification would call the same failing provider.');
          if(typeof message.answer!=='string' || !message.answer.trim() || message.answer.length>2000)throw new Error('Enter a brief answer.');
          await update({...skillRun,status:'running',question:null,answers:[...skillRun.answers,{question:skillRun.question,answer:message.answer.trim()}],inputReply:{mode:'clarification'}});
        }
      }else if(message.kind==='skills:cancel'){
        const {skillRun}=await chrome.storage.session.get('skillRun');
        if(['running','needs_input'].includes(skillRun?.status)){
          await update({...skillRun,status:'cancelled',message:'Stopped. Already dispatched actions remain on the page.'});
          const skill=skills.find(item=>item.id===skillRun.skillId);if(skill && skill.family!==NETWORKING)await gateRequest('finish',skill,{runId:skillRun.id,status:'cancelled'}).catch(()=>{});
        }
      }else throw new Error('Unknown skill command.');
      return state();
    }).then(value=>respond(isView?{ok:true,value}:{ok:true,waiting:message.kind==='skills:help-status'}),error=>respond({ok:false,error:error.message}));return true;
  });
}
