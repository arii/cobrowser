/// <reference types="chrome" />
import { chromium } from 'playwright';
import { mkdir, mkdtemp, rm, writeFile, rename } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import assert from 'node:assert/strict';
import { startFixture } from '../apps/fixture-site/server.js';
import { newId } from '../packages/contracts/src/index.js';
import { buildContextHost } from './context-host-runtime.js';

const root=await mkdtemp(join(tmpdir(),'cobrowser-gate-acceptance-'));
const fixture=await startFixture();
const quote=(value:string)=>`'${value.replaceAll("'","'\\''")}'`;
let context:Awaited<ReturnType<typeof chromium.launchPersistentContext>>|undefined;
try{
  await buildContextHost(root);
  const launcher=join(root,'host');
  await writeFile(launcher,`#!/bin/sh\nexport COBROWSER_GATE_ROOT=${quote(join(root,'registry'))}\nexport COBROWSER_CONTEXT_REPLAY=1\nexport COBROWSER_HISTORY_ROOT=${quote(join(root,'history'))}\nexec ${quote(process.execPath)} ${quote(join(root,'host.cjs'))} "$@"\n`,{mode:0o700});
  const profile=join(root,'profile');await mkdir(join(profile,'NativeMessagingHosts'),{recursive:true});
  const extensionId='afchllcepipgheklaapddihncbpmfocl';
  await writeFile(join(profile,'NativeMessagingHosts/com.cobrowser.context.json'),JSON.stringify({name:'com.cobrowser.context',description:'Isolated gate acceptance host',path:launcher,type:'stdio',allowed_origins:[`chrome-extension://${extensionId}/`]}));
  const extension=resolve('apps/extension/.output/chrome-mv3');
  context=await chromium.launchPersistentContext(profile,{channel:'chromium',headless:true,acceptDownloads:true,args:[`--disable-extensions-except=${extension}`,`--load-extension=${extension}`]});
  const worker=context.serviceWorkers()[0]??await context.waitForEvent('serviceworker');assert.equal(worker.url().split('/')[2],extensionId);
  const view=await context.newPage(),errors:string[]=[];view.on('pageerror',error=>errors.push(error.message));
  await view.goto(`chrome-extension://${extensionId}/skills.html`);
  const send=(kind:string,extra:Record<string,unknown>={})=>view.evaluate(message=>chrome.runtime.sendMessage(message),{kind,...extra});
  const skill={id:newId(),title:'Verified weekly CSV',customTitle:true,origin:fixture.origin,sites:[{id:'main',url:fixture.origin+'/'}],instruction:'Download the previous calendar week CSV according to the explicit verification task.',active:true,qualityVersion:3,exampleCount:1,examples:[{at:new Date().toISOString(),eventIds:['synthetic-import'],effect:'form-submitted'}],steps:[{kind:'change',target:{tag:'SELECT',label:'Team',type:''},parameter:'input_1'},{kind:'change',target:{tag:'INPUT',label:'Start inclusive',type:''},parameter:'input_2'},{kind:'change',target:{tag:'INPUT',label:'End exclusive',type:''},parameter:'input_3'},{kind:'click',target:{tag:'BUTTON',label:'Export CSV',type:'submit'},parameter:null}]};
  await view.evaluate(async skill=>{await chrome.storage.local.set({skillLibrary:[skill]});},skill);
  let value=await send('skills:list');assert.equal(value.value.skills[0].active,false,'Legacy active flags grant no authorization.');
  assert.equal((await send('skills:run',{id:skill.id})).ok,false);
  assert.equal(fixture.audit.length,0);
  const task={family:'synthetic-weekly-report-v1',team:'blue',asOf:'2026-11-07T20:00:00.000Z',timezone:'America/Los_Angeles'};
  const unsupported={...skill,id:newId(),steps:[{...skill.steps[0]},{...skill.steps[3],target:{tag:'BUTTON',label:'Preview report',type:'button'}}]};
  await view.evaluate(async skill=>{const skillLibrary=(await chrome.storage.local.get('skillLibrary')).skillLibrary as any[];await chrome.storage.local.set({skillLibrary:[...skillLibrary,skill]});},unsupported);
  const refused=await send('skills:activate',{id:unsupported.id,active:true,reviewed:true,verificationTask:task});assert.equal(refused.ok,false);assert.match(refused.error,/No independent verifier supports/);
  const networking={...skill,id:newId(),family:'guest-list-linkedin-v1',networking:{version:1,maxGuests:1},networkingReview:{binding:'forged'},sites:[{id:'guests',url:fixture.origin+'/'},{id:'linkedin',url:'https://www.linkedin.com/'}],steps:[],examples:[{at:new Date().toISOString(),eventIds:['a','b','c'],effect:'content-changed'}]};
  await view.evaluate(async skill=>{const skillLibrary=(await chrome.storage.local.get('skillLibrary')).skillLibrary as any[];await chrome.storage.local.set({skillLibrary:[...skillLibrary,skill]});},networking);
  for(const kind of ['skills:activate','skills:run']){const result=await send(kind,{id:networking.id,active:true,reviewed:true});assert.equal(result.ok,false);assert.match(result.error,/Networking requires independent verification/);}
  // Exercise the actual UI, native host, real candidate browser and registry.
  await view.getByRole('button',{name:'Refresh examples'}).click();
  const card=view.locator('#skills-library > article').filter({hasText:'Verified weekly CSV'}).first();
  await card.locator('summary').first().click();
  await card.getByLabel('Verified report team').selectOption('blue');
  await card.getByRole('checkbox').check();
  await card.getByRole('button',{name:'Verify and activate',exact:true}).click();
  await card.getByRole('button',{name:'Run approved skill',exact:true}).waitFor({timeout:60000});
  value=await send('skills:list');const approved=value.value.skills.find((item:any)=>item.id===skill.id);assert.equal(approved.active,true);assert.equal(approved.approval.normalRuns,10);
  assert.equal(fixture.audit.length,0,'Candidate verification must use the isolated supervisor fixture, not the user page.');
  const pagesBefore=context.pages().length;
  const wrong=await send('skills:run',{id:skill.id,parameters:{input_1:'red'}});assert.equal(wrong.ok,false);assert.match(wrong.error,/differs from the verified task/);assert.equal(context.pages().length,pagesBefore);
  const downloadPending=context.waitForEvent('page').then(page=>page.waitForEvent('download'));
  await card.getByRole('button',{name:'Run approved skill',exact:true}).click();
  const waitRun=async()=>{const deadline=Date.now()+45000;while(Date.now()<deadline){const result=(await send('skills:list')).value.run;if(result?.finishedAt)return result;await view.waitForTimeout(100);}throw new Error('extension-run-timeout');};
  const run=await waitRun();assert.equal(run.status,'finished',JSON.stringify(run));assert.equal(run.completed,4);assert.equal(run.approvedCandidateHash,approved.approval.candidateHash);assert.equal(run.verification[0].status,'verified');
  const download=await downloadPending,stream=await download.createReadStream();const chunks:Buffer[]=[];for await(const chunk of stream)chunks.push(Buffer.from(chunk));const bytes=Buffer.concat(chunks).toString();assert.match(bytes,/blue,2026-10-26,226/);assert.equal(fixture.audit.length,1);
  console.log('PASS: real UI → native verification → 10/10 candidate runs → approval → authorized Chrome CSV download');
  await rename(launcher,launcher+'.offline');
  try{
    const before=context.pages().length;
    const offline=await send('skills:run',{id:skill.id});assert.equal(offline.ok,false);assert.match(offline.error,/Verification host unavailable/);assert.equal(context.pages().length,before);assert.equal(fixture.audit.length,1);
  }finally{await rename(launcher+'.offline',launcher);}
  // Editing storage while retaining a forged active flag cannot reuse approval.
  await view.evaluate(async id=>{const skillLibrary=(await chrome.storage.local.get('skillLibrary')).skillLibrary as any[];const skill=skillLibrary.find((item:any)=>item.id===id);skill.steps[3].target.label='Download CSV';await chrome.storage.local.set({skillLibrary});},skill.id);
  const tampered=await send('skills:run',{id:skill.id});assert.equal(tampered.ok,false);assert.match(tampered.error,/changed after verification/);assert.equal(fixture.audit.length,1);
  await view.evaluate(async skill=>{const skillLibrary=(await chrome.storage.local.get('skillLibrary')).skillLibrary as any[];const existing=skillLibrary.find((item:any)=>item.id===skill.id);Object.assign(existing,{steps:skill.steps});await chrome.storage.local.set({skillLibrary});},skill);
  assert.equal((await send('skills:activate',{id:skill.id,active:false})).ok,true);
  // Local flag spoofing after host revocation is still rejected before tabs open.
  await view.evaluate(async id=>{const skillLibrary=(await chrome.storage.local.get('skillLibrary')).skillLibrary as any[];const entry=skillLibrary.find((item:any)=>item.id===id);entry.active=true;entry.approval={verdict:'approved'};await chrome.storage.local.set({skillLibrary});},skill.id);
  assert.equal((await send('skills:run',{id:skill.id})).ok,false);
  assert.equal(fixture.audit.length,1);
  assert.deepEqual(errors,[]);
  await mkdir('.local/evidence',{recursive:true});
  await writeFile('.local/evidence/extension-gate.json',JSON.stringify({mode:'real-chrome-native-host-synthetic-reporting',approval:approved.approval,run,checks:{legacyFlagBlocked:true,unsupportedWorkflowBlocked:true,networkingManualReviewCannotBypassGate:true,tenCandidateRuns:true,wrongInputsBlockedBeforeTabs:true,actualDownload:true,offlineHostBlockedBeforeTabs:true,tamperedStepsBlocked:true,deactivatedNativeApprovalCannotBeSpoofed:true},isolation:'trusted local native supervisor; browser contexts and fixture routing; no hostile-candidate sandbox',pageErrors:errors},null,2));
  console.log('PASS: local flags, unsupported workflows, changed inputs, modified steps and revoked approval cannot bypass the gate');
}finally{await context?.close();await fixture.close();await rm(root,{recursive:true,force:true});}
