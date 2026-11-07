import { TaskHistoryStore } from '../packages/context-brain/history.js';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { ContextBrain, type BrainView } from '../packages/context-brain/engine.js';
import { liveContextProviders } from '../packages/model-adapters/context.js';
import { syntheticContextProviders } from '../packages/context-brain/replay.js';
import { BrainEvent } from '../packages/context-brain/contracts.js';

const args=process.argv.slice(2);
const synthetic=args.includes('--demo') || args.includes('--replay');
const providers=synthetic?syntheticContextProviders():liveContextProviders();
const brain=new ContextBrain(providers,undefined,args.includes('--record')&&!synthetic?new TaskHistoryStore(resolve('.local/context-brain/task-history')):undefined);
const output=resolve('.local/context-brain');
await mkdir(output,{recursive:true,mode:0o700});
async function persist(view:BrainView) {
  // Bounded, retention-filtered snapshots. No screenshot bytes or secrets are written.
  for (const [name,body] of [['state.json',JSON.stringify(view,null,2)],['journal.jsonl',view.journal.map(entry=>JSON.stringify(entry)).join('\n')+'\n']]) {
    const temporary=join(output,`${name}.tmp`);
    await writeFile(temporary,body,{mode:0o600});await rename(temporary,join(output,name));
  }
}
if (args.includes('--record')) {
  const { runBrowserBrain }=await import('./context-brain-browser.js');
  await runBrowserBrain(brain,persist);
} else if (args.includes('--demo')) {
  const event=(kind:BrainEvent['kind'],tabId=1):BrainEvent=>({id:randomUUID(),at:new Date().toISOString(),sessionId:'synthetic-session',origin:'http://127.0.0.1:3210',tabId,provenance:'human',kind,tag:kind==='submit'?'FORM':'INPUT'});
  for (const input of [event('change'),event('submit'),event('submit'),event('click',2)]) {
    const view=await brain.observe([input]);await persist(view);
    console.log(JSON.stringify({mode:view.mode,intent:view.working?.intent,pendingSwitches:view.pendingSwitches,retired:view.archived.length,lastDecision:view.journal.findLast(entry=>entry.kind==='intent-assessment')}));
  }
  console.log(`SYNTHETIC DEMO ONLY: no provider calls. Inspect ${join(output,'state.json')} and journal.jsonl.`);
} else {
  const inputIndex=args.indexOf('--input');
  if (inputIndex<0 || !args[inputIndex+1]) throw new Error('Use --record for a live browser feed, --input recording-export.json, or --demo for synthetic evidence.');
  const source=JSON.parse(await readFile(resolve(args[inputIndex+1]),'utf8'));
  if (!Array.isArray(source.events) || source.events.length>2000) throw new Error('invalid-recording-export');
  const events=source.events.map((event:unknown)=>BrainEvent.parse(event));
  if (events.some((event:BrainEvent)=>Date.now()-Date.parse(event.at)>=24*3600000 || Date.parse(event.at)>Date.now()+5000)) throw new Error('export-outside-retention');
  let eventTime=Date.now();
  const playback=new ContextBrain(providers,()=>eventTime);
  const processBatch=async(batch:BrainEvent[])=>{eventTime=Date.parse(batch.at(-1)!.at);await persist(await playback.observe(batch));};
  // Process chronological groups without mixing evidence from different scopes.
  let batch:BrainEvent[]=[];
  const scope=(event:BrainEvent)=>`${event.sessionId}|${event.origin}|${event.tabId}`;
  for (const event of events) {
    if (batch.length && (batch.length>=4 || scope(batch[0])!==scope(event))) {await processBatch(batch);batch=[];}
    batch.push(event);
  }
  if (batch.length) await processBatch(batch);
  console.log(JSON.stringify(playback.view(),null,2));
}
