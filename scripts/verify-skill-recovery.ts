import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import assert from 'node:assert/strict';
const server=createServer((_req,res)=>res.end(`<!doctype html><title>Recovery fixture</title><h1>Report recovery</h1>
<button type="button" id="open" onclick="window.openCount=(window.openCount||0)+1;document.querySelector('form').hidden=false">Open report</button>
<form hidden onsubmit="event.preventDefault();window.previewCount=(window.previewCount||0)+1;document.querySelector('output').textContent='Preview '+document.querySelector('#start').value+' '+document.querySelector('#team').value">
<label>Team <select name="team" id="team" onchange="window.teamCount=(window.teamCount||0)+1"><option value="r">Red</option><option value="b">Blue</option></select></label>
<label>Start inclusive <input id="start" name="start" type="text" onchange="window.inputCount=(window.inputCount||0)+1"></label>
<label>CDP typing probe <input id="probe" name="probe" aria-label="CDP typing probe" data-cobrowser-probe></label>
<label>Disabled field <input name="disabled" disabled></label><label>Hidden field <input name="hidden" hidden></label><label>Not submitted <input></label>
<button type="submit">Export CSV</button></form><output></output>`));
await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
const origin=`http://127.0.0.1:${(server.address() as {port:number}).port}`;
const profile=await mkdtemp(join(tmpdir(),'skill-recovery-')),extension=resolve('apps/extension/.output/chrome-mv3');
const context=await chromium.launchPersistentContext(profile,{channel:'chromium',headless:true,args:[`--disable-extensions-except=${extension}`,`--load-extension=${extension}`]});
try{
  const worker=context.serviceWorkers()[0]??await context.waitForEvent('serviceworker'),id=worker.url().split('/')[2];
  const popup=await context.newPage(),errors:string[]=[];popup.on('pageerror',error=>errors.push(error.message));
  await popup.goto(`chrome-extension://${id}/skills.html`);
  const send=(kind:string,args={})=>popup.evaluate(message=>(globalThis as any).chrome.runtime.sendMessage(message),{kind,...args});
  const steps=[{kind:'click',parameter:null,target:{tag:'BUTTON',label:'Open report',type:'button'}},{kind:'change',parameter:'input_2',target:{tag:'SELECT',label:'Team',type:''}},{kind:'change',parameter:'input_3',target:{tag:'INPUT',label:'Start inclusive',type:'text'}},{kind:'click',parameter:null,target:{tag:'BUTTON',label:'Export CSV',type:'submit'}}];
  const skill={id:'recovery',title:'Export CSV',origin,sites:[{id:'main',url:origin}],steps,qualityVersion:3,examples:[{effect:'content-changed',eventIds:['fixture'],at:new Date().toISOString()}],exampleCount:1,active:true};
  await worker.evaluate(async skill=>{await (globalThis as any).chrome.storage.local.set({skillLibrary:[skill]});},skill);
  await worker.evaluate(()=>{const global=globalThis as any;global.__calls=[];global.chrome.runtime.sendNativeMessage=async(_host:string,message:any)=>{global.__calls.push(message.target.label);return {kind:'skill-input-error',seq:message.seq,code:'context-provider-network-or-timeout'};};});
  const retryMessages:string[]=[];
  async function waitRun(predicate:(run:any)=>boolean){
    for(let attempt=0;attempt<250;attempt++){
      const run=(await send('skills:list')).value.run;
      if(run?.retry)retryMessages.push(run.message);
      if(predicate(run))return run;
      if(run?.status==='failed')throw new Error(JSON.stringify(run));
      await popup.waitForTimeout(100);
    }
    throw new Error('Timed out waiting for run state.');
  }
  assert.equal((await send('skills:run',{id:skill.id,instruction:'Preview the report.'})).ok,true);
  let run=await waitRun(run=>run?.status==='needs_input');
  assert.equal(run.completed,1);assert.equal(run.issue.kind,'provider');assert.match(run.question,/provider unavailable/i);assert.doesNotMatch(run.question,/fix the page/i);
  assert.equal(retryMessages.some(message=>message.includes('Retrying 2 / 3')),true);
  assert.equal(retryMessages.some(message=>message.includes('Retrying 3 / 3')),true);
  assert.deepEqual(await worker.evaluate(()=>(globalThis as any).__calls),['Team','Team','Team']);
  const token=run.helpToken;
  assert.equal((await send('skills:answer',{runId:run.id,helpToken:token,answer:'Use blue'})).ok,false,'Outages must not accept a clarification that restarts the failing provider.');
  assert.equal((await send('skills:answer',{runId:run.id,helpToken:token,mode:'value',value:'Green'})).ok,false,'Unavailable select options are rejected before resuming.');
  const page=context.pages().find(page=>page.url().startsWith(origin))!;
  await page.locator('[data-cobrowser-skill-help]').waitFor({state:'attached'});
  await mkdir('.local/evidence',{recursive:true});await page.screenshot({path:'.local/evidence/skill-provider-outage.png'});
  await page.evaluate(()=>{const cover=document.createElement('div');cover.id='cover';cover.style.cssText='position:fixed;inset:0;background:white;z-index:2147483000';document.body.append(cover);});
  await page.keyboard.type('Blue');await page.keyboard.press('Control+Enter');
  const pageIssue=await waitRun(run=>run?.status==='needs_input' && run.issue?.kind!=='provider');
  assert.equal(pageIssue.completed,1);assert.equal((await worker.evaluate(()=>(globalThis as any).__calls)).length,3);
  await page.evaluate(()=>document.querySelector('#cover')!.remove());
  assert.equal((await send('skills:answer',{runId:pageIssue.id,helpToken:pageIssue.helpToken,answer:'The covering panel is removed.'})).ok,true);

  run=await waitRun(run=>run?.status==='needs_input' && run.pendingInput?.label==='Start inclusive');
  assert.equal(run.completed,2);
  assert.equal(await page.locator('#team').inputValue(),'b','Exact visible labels map to the underlying select value.');
  assert.equal((await send('skills:answer',{runId:run.id,helpToken:token,mode:'value',value:'wrong'})).ok,false,'A stale prompt cannot resume another step.');
  await popup.bringToFront();
  await popup.waitForFunction(()=>document.querySelector('#skills-run')?.textContent?.includes('Exact value for “Start inclusive”'));
  await popup.locator('#skills-run textarea').fill(' 2026-10-26 ');
  await popup.getByRole('button',{name:'Use exact value',exact:true}).click();
  run=await waitRun(run=>run?.status==='finished');
  assert.equal(run.completed,4);assert.equal(run.inputReply,undefined);assert.equal(run.instruction,undefined);
  assert.equal((await worker.evaluate(()=>(globalThis as any).__calls)).length,6,'Direct answers make no additional model calls.');
  assert.deepEqual(await page.evaluate(()=>{const global=window as any;return [global.openCount,global.teamCount,global.inputCount,global.previewCount];}),[1,1,1,1],'Resume never duplicates completed actions.');
  assert.equal(await page.locator('#start').inputValue(),' 2026-10-26 ');
  assert.equal((await send('skills:answer',{runId:run.id,helpToken:run.helpToken,mode:'value',value:'again'})).ok,false);
  // A genuinely missing detail can also be supplied directly without asking the model again.
  await worker.evaluate(()=>{const global=globalThis as any;global.__calls=[];global.chrome.runtime.sendNativeMessage=async(_host:string,message:any)=>{global.__calls.push(message.target.label);return {kind:'skill-input-result',seq:message.seq,decision:{status:'needs_input',value:null,question:'Which team?',sourceSiteIds:[],explanation:'Team was not specified.'}};};});
  assert.equal((await send('skills:run',{id:skill.id,instruction:'Preview.',parameters:{input_3:'date'}})).ok,true);
  run=await waitRun(run=>run?.status==='needs_input');assert.equal(run.issue,null);
  assert.equal((await send('skills:answer',{runId:run.id,helpToken:run.helpToken,mode:'value',value:'Red'})).ok,true);
  await waitRun(run=>run?.status==='finished');assert.equal((await worker.evaluate(()=>(globalThis as any).__calls)).length,1);
  // Automatic recovery retries only planning, then dispatches exactly once.
  await worker.evaluate(()=>{const global=globalThis as any;global.__calls=[];global.chrome.runtime.sendNativeMessage=async(_host:string,message:any)=>{global.__calls.push(message.target.label);return global.__calls.length<3?{kind:'skill-input-error',seq:message.seq,code:'context-provider-http-503'}:{kind:'skill-input-result',seq:message.seq,decision:{status:'resolved',value:'Blue',question:null,sourceSiteIds:[],explanation:'Explicit instruction.'}};};});
  assert.equal((await send('skills:run',{id:skill.id,instruction:'Use Blue.',parameters:{input_3:'date'}})).ok,true);
  run=await waitRun(run=>run?.status==='finished');assert.equal(run.completed,4);assert.equal((await worker.evaluate(()=>(globalThis as any).__calls)).length,3);
  // Previously saved probe fields cannot be activated; repair is explicit and auditable.
  await worker.evaluate(async({skill,steps})=>{await (globalThis as any).chrome.storage.local.set({skillLibrary:[{...skill,id:'contaminated',steps:[{kind:'change',parameter:'input_9',target:{tag:'INPUT',label:'CDP typing probe',type:''}},...steps]}]});},{skill,steps});
  let listing=(await send('skills:list')).value;
  assert.equal(listing.skills[0].active,false);assert.equal(listing.skills[0].needsExamples,true);
  assert.equal((await send('skills:activate',{id:'contaminated',active:true,reviewed:true})).ok,false);
  listing=(await send('skills:repair',{id:'contaminated'})).value;
  assert.equal(listing.skills[0].steps.length,4);assert.equal(listing.skills[0].active,false);assert.equal(listing.skills[0].repairHistory.length,1);
  // The real content recorder excludes probes and native form inputs that cannot be replayed.
  await worker.evaluate(async()=>{await (globalThis as any).chrome.storage.local.set({skillLibrary:[]});});
  assert.equal((await send('recording:start')).ok,true);
  const human=await context.newPage();await human.goto(origin);await human.bringToFront();
  await human.locator('#open').click();await human.waitForTimeout(300);
  await human.locator('#probe').fill('probe activity');await human.locator('#start').fill('date');await human.locator('#team').selectOption('b');
  await human.getByRole('button',{name:'Export CSV',exact:true}).click();await human.waitForTimeout(600);
  const recording=(await send('recording:status')).value.events;
  const recorderVersion=await worker.evaluate(async origin=>{const chrome=(globalThis as any).chrome;const tab=(await chrome.tabs.query({url:origin+'/*'})).find((tab:any)=>tab.active);return (await chrome.tabs.sendMessage(tab.id,{kind:'recording:context-request'})).recorderVersion;},origin);
  assert.equal(recorderVersion,4,'Open pages use the recorder version with probe exclusion.');
  assert.equal(recording.some((event:any)=>event.target?.label==='CDP typing probe'),false);
  const outcome=recording.findLast((event:any)=>event.target?.label==='Export CSV');assert.ok(outcome,JSON.stringify(recording));
  assert.deepEqual(outcome.formTargets.map((target:any)=>target.label),['Team','Start inclusive']);
  listing=(await send('skills:list')).value;
  assert.ok(listing.skills.some((item:any)=>item.learnedAutomatically && !item.needsExamples),'First supported attempt still learns automatically.');
  assert.equal(listing.skills.some((item:any)=>item.steps.some((step:any)=>step.target?.label==='CDP typing probe')),false);
  // Assignment and lifetime ownership exclude trusted CDP events, including delayed input.
  const tabId=await worker.evaluate(async origin=>(await (globalThis as any).chrome.tabs.query({url:origin+'/*'})).find((tab:any)=>tab.active).id,origin);
  await worker.evaluate(async tabId=>{await (globalThis as any).chrome.storage.session.set({assigned:{tabId},automationTabIds:[tabId]});},tabId);
  const before=(await send('recording:status')).value.events.length;
  await human.locator('#start').fill('assigned input');await human.getByRole('button',{name:'Export CSV',exact:true}).click();await human.waitForTimeout(1000);
  assert.equal((await send('recording:status')).value.events.length,before);
  await worker.evaluate(async()=>{await (globalThis as any).chrome.storage.session.remove('assigned');});
  await human.locator('#start').fill('after detach');await human.getByRole('button',{name:'Export CSV',exact:true}).click();await human.waitForTimeout(1000);
  assert.equal((await send('recording:status')).value.events.length,before);
  const monitor=await context.newPage();await monitor.goto(`chrome-extension://${id}/recording.html`);
  await monitor.waitForFunction(()=>document.querySelector('#skill-decision-status')?.textContent?.includes('updated'));
  assert.equal(await monitor.getByRole('heading',{name:'Live skill decisions',exact:true}).count(),1);
  assert.deepEqual(errors,[]);
  await writeFile('.local/evidence/skill-recovery.json',JSON.stringify({providerRetries:3,directValueModelCalls:0,dispatchCounts:[1,1,1,1],selectValidation:true,stalePromptRejected:true,automaticRecovery:true,firstAttemptLearning:true,probeExclusion:true,assignedAndDetachedTabExclusion:true,repairRequiresReview:true,liveDecisionMonitor:true,errors},null,2));
  console.log('Skill recovery verified: bounded visible retries, direct values offline, select validation, no duplicate dispatch, stale prompts, automatic recovery, probe exclusion, repair, proactive learning and live monitor.');
}finally{await context.close();await rm(profile,{recursive:true,force:true});server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));}
