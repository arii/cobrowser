import { TaskHistoryStore } from '../packages/context-brain/history.js';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ContextBrain } from '../packages/context-brain/engine.js';
import { BrainEvent, type BrainInput, type BrainProviders, type ContextDecision, type SnapSignals, type CallResult } from '../packages/context-brain/contracts.js';

const stamp=Date.now();
function setup(history=new TaskHistoryStore()) {
  let now=stamp,index=0;
  const calls:BrainInput[]=[];
  let decision:Partial<ContextDecision>={};
  let signals:SnapSignals={taskRelation:'same',relationConfidence:.95,screenChanged:null,actionClass:'editing',actionConfidence:.95,visualTask:'unknown',visualState:'unknown',visualConfidence:0};
  let failSnap=false,failPreview=false;
  const result=<T>(value:T):CallResult<T>=>({value,model:'synthetic',mode:'replay',latencyMs:10,inputHash:'synthetic-hash',usage:{},version:'test-v1'});
  const providers:BrainProviders={mode:'replay',snap:async()=>{if(failSnap) throw new Error('private provider failure');return result(signals);},context:async input=>{
    calls.push(structuredClone(input));if(failPreview) throw new Error('private provider failure');
    return result({intent:'Task A',summary:'Task A summary',status:'continuing',confidence:.9,evidenceIds:[input.events.at(-1)!.id],explanation:'Observed field change',nextAction:{kind:'unknown',description:'Insufficient evidence',confidence:0,targetTabId:null,evidenceIds:[input.events.at(-1)!.id]},...decision});
  }};
  const brain=new ContextBrain(providers,()=>now,history);
  const event=(extra:Partial<BrainEvent>={}):BrainEvent=>{now+=100;return {id:`event-${++index}`,at:new Date(now).toISOString(),sessionId:'session-a',origin:'http://127.0.0.1:3210',tabId:1,kind:'change',tag:'INPUT',provenance:'human',...extra};};
  return {brain,calls,event,providers,history,now:()=>now,advance:(ms:number)=>{now+=ms;},setDecision:(value:Partial<ContextDecision>)=>{decision=value;},different:()=>{signals={...signals,taskRelation:'different'};},failSnap:()=>{failSnap=true;},failPreview:()=>{failPreview=true;}};
}
test('rolling summaries replace prior summary, evidence stays bounded, pointer-only updates call no models',async()=>{
  const s=setup();
  for(let i=0;i<20;i++) await s.brain.observe([s.event()]);
  assert.equal(s.brain.view().recent.length,12);
  assert.equal(s.calls.at(-1)!.previous!.summary,'Task A summary');
  assert(s.calls.every(call=>call.events.length<=12));
  const passive=s.event({kind:'pointer',tag:'PAGE',x:.5,y:.2});
  await s.brain.observe([passive]);await s.brain.observe([passive]);
  assert.equal(s.calls.length,20);
  assert.equal(s.brain.view().providers.snap.calls,20);
  assert.equal(s.brain.view().journal.at(-1)!.kind,'fast-path');
});
test('two matching corroborated changes retire old context, which never reaches later model calls',async()=>{
  const s=setup();await s.brain.observe([s.event()]);
  s.different();s.setDecision({intent:'Task B',summary:'Only new task evidence',status:'new_task'});
  await s.brain.observe([s.event()]);assert.equal(s.brain.view().working!.intent,'Task A');
  await s.brain.observe([s.event()]);
  const switched=s.brain.view();assert.equal(switched.working!.intent,'Task B');assert.equal(switched.archived.length,1);assert.equal(switched.recent.length,2);
  s.setDecision({intent:'Task B',summary:'New task continues'});await s.brain.observe([s.event()]);
  assert(!JSON.stringify(s.calls.at(-1)).includes('Task A'));
  assert.equal(s.calls.at(-1)!.events.length,3);
});
test('inconsistent candidates and unsupported change hypotheses cannot erase active memory',async()=>{
  const s=setup();await s.brain.observe([s.event()]);
  s.setDecision({intent:'Task B',status:'new_task'});await s.brain.observe([s.event()]);
  assert.equal(s.brain.view().pendingSwitches,0);
  s.different();await s.brain.observe([s.event()]);
  s.setDecision({intent:'Task C',status:'new_task'});await s.brain.observe([s.event()]);
  assert.equal(s.brain.view().working!.intent,'Task A');assert.equal(s.brain.view().pendingSwitches,1);
});
test('tab/session changes, idle time, and completion keep full history until a confirmed topic change',async()=>{
  const s=setup();await s.brain.observe([s.event()]);const id=s.brain.view().working!.taskId;
  await s.brain.observe([s.event({tabId:2})]);s.advance(121000);
  assert.equal(s.brain.view().working!.taskId,id);assert.equal(s.brain.view().recent.length,0);
  await s.brain.observe([s.event({sessionId:'session-b',tabId:2})]);
  assert.equal(s.calls.at(-1)!.previous!.taskId,id);assert.equal(s.brain.view().history.totalActions,3);
  s.setDecision({status:'completed'});await s.brain.observe([s.event({sessionId:'session-b',tabId:2})]);
  await s.brain.observe([s.event({sessionId:'session-b',tabId:2})]);assert.equal(s.brain.view().working!.taskId,id);
  s.advance(25*3600000);assert.equal(s.brain.view().history.totalActions,5);
  s.brain.clear();assert.equal(s.brain.view().working,null);assert.equal(s.brain.view().history.totalActions,0);
});
test('Snap outage is explicit to Preview; Preview failure and invalid references never install invented context',async()=>{
  const s=setup();s.failSnap();await s.brain.observe([s.event()]);assert.equal(s.calls[0].signals,null);
  s.setDecision({intent:'Invented',evidenceIds:['nonexistent']});await s.brain.observe([s.event()]);assert.equal(s.brain.view().working!.intent,'Task A');assert.equal(s.brain.view().working!.status,'uncertain');
  s.failPreview();await s.brain.observe([s.event()]);
  assert(!JSON.stringify(s.brain.view()).includes('private provider failure'));
});
test('agent evidence, text keys, mixed scopes, stale events and mismatched screenshots are rejected before provider calls',async()=>{
  const s=setup();
  await assert.rejects(s.brain.observe([{...s.event(),provenance:'agent'}]));
  await assert.rejects(s.brain.observe([{...s.event({kind:'key'}),key:'a'}]));
  await assert.rejects(s.brain.observe([s.event(),s.event({tabId:2})]),/mixed-scope/);
  const stale=s.event();s.advance(6000);await s.brain.observe([s.event()]);await assert.rejects(s.brain.observe([stale]),/stale-event/);
  await assert.rejects(s.brain.observe([s.event()],[{image:{mediaType:'image/png',base64:'iVBORw0KGgo='},at:new Date(stamp).toISOString(),sessionId:'wrong-session',tabId:1,origin:'http://127.0.0.1:3210'}]),/frame-scope/);
  assert.equal(s.calls.length,1);
});
test('raw images are transient; logs retain only hashes and timestamps',async()=>{
  const s=setup();const event=s.event();
  await s.brain.observe([event],[{image:{mediaType:'image/png',base64:'iVBORw0KGgo='},at:event.at,sessionId:event.sessionId,origin:event.origin,tabId:event.tabId}]);
  const view=JSON.stringify(s.brain.view());assert(!view.includes('iVBORw0KGgo='));assert(view.includes('hash'));
});
test('backpressure rejects overlapping inference rather than applying late stale decisions',async()=>{
  const s=setup();let release!:()=>void;
  const wait=new Promise<void>(resolve=>{release=resolve;});const original=s.providers.snap;
  s.providers.snap=async input=>{await wait;return original(input);};
  const first=s.brain.observe([s.event()]);await assert.rejects(s.brain.observe([s.event()]),/context-busy/);
  assert.throws(()=>s.brain.clear(),/context-busy/);release();await first;
});
test('action-only analysis bypasses Snap after measured slower calls while Preview retains context ownership',async()=>{
  const s=setup();const original=s.providers.snap;
  s.providers.snap=async input=>({...await original(input),latencyMs:100});
  for(let i=0;i<4;i++) await s.brain.observe([s.event()]);
  assert.equal(s.brain.view().providers.snap.calls,3);assert.equal(s.brain.view().providers.context.calls,4);
  assert.equal(s.calls.at(-1)!.signals,null);
  assert(s.brain.view().journal.some(entry=>entry.reason==='action-analysis-Snap-measured-slower'));
});
test('next-action forecasts use open-tab context and reject invented targets or evidence',async()=>{
  const s=setup();const event=s.event();
  s.brain.setTabs([{tabId:7,origin:'https://reports.example',title:'Reports',headings:['Export report'],excerpt:'Choose a report',active:false,observedAt:event.at,readStatus:'ready'}]);
  s.setDecision({nextAction:{kind:'switch-tab',description:'Switch to the Reports tab',targetTabId:7,confidence:.7,evidenceIds:[event.id]}});
  await s.brain.observe([event]);assert.equal(s.calls[0].tabs?.[0].title,'Reports');assert.equal(s.brain.view().working?.nextAction.targetTabId,7);
  const second=s.event();
  s.setDecision({nextAction:{kind:'switch-tab',description:'Invented target',targetTabId:999,confidence:.9,evidenceIds:[second.id]}});
  await s.brain.observe([second]);assert.equal(s.brain.view().working?.nextAction.kind,'unknown');
  const third=s.event();
  s.setDecision({nextAction:{kind:'click',description:'Invented evidence',targetTabId:null,confidence:.9,evidenceIds:['invented-id']}});
  await s.brain.observe([third]);assert.equal(s.brain.view().working?.nextAction.confidence,0);
  s.advance(31000);assert.equal(s.brain.view().tabs.length,0);
});

test('durable full task history restores summaries, retrieves older actions on demand, and isolates confirmed topics',async()=>{
  const root=await mkdtemp(join(tmpdir(),'cobrowser-history-'));
  try{
    const history=new TaskHistoryStore(root),s=setup(history);
    const first=s.event({kind:'click',tag:'BUTTON',target:{tag:'BUTTON',label:'Quarterly export settings',type:'button'}});
    await s.brain.observe([first]);
    for(let index=0;index<30;index++)await s.brain.observe([s.event()]);
    assert.equal(history.active!.events.length,31);assert.equal(s.brain.view().recent.length,12);
    s.setDecision({historyQuery:'Quarterly export settings'});await s.brain.observe([s.event()]);
    const input=s.calls.at(-1)!;assert(input.history!.retrievedEvents.some(event=>event.id===first.id));assert(input.events.length<=12);assert(input.history!.retrievedEvents.length<=6);
    const reopened=new TaskHistoryStore(root),restored=new ContextBrain(s.providers,s.now,reopened);
    assert.equal(restored.view().working!.summary,'Task A summary');assert.equal(restored.view().history.totalActions,32);
    assert.equal(reopened.active!.events[0].id,first.id);
    s.different();s.setDecision({intent:'Task B',summary:'Only task B',status:'new_task',historyQuery:null});
    const boundary=s.event();await s.brain.observe([boundary]);await s.brain.observe([s.event()]);
    assert.equal(history.archived.length,1);assert.equal(history.archived[0].events.length,32);
    assert.equal(history.active!.events.length,2);assert.equal(history.active!.events[0].id,boundary.id);
    s.setDecision({intent:'Task B',summary:'Only task B',status:'continuing',historyQuery:'Quarterly export settings'});await s.brain.observe([s.event()]);
    assert.equal(s.calls.at(-1)!.history!.retrievedEvents.some(event=>event.id===first.id),false);
    assert.equal(new TaskHistoryStore(root).archived[0].events.length,32);
    s.brain.clear();assert.equal((await readFile(join(root,'tasks.jsonl'),'utf8')).length,0);
  }finally{await rm(root,{recursive:true,force:true});}
});
