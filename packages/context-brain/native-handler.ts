import { z } from 'zod';
import { createHash, randomUUID } from 'node:crypto';
import { ContextBrain } from './engine.js';
import { BrainEvent, TabContext, IntervalEvidence, type BrainProviders, type ContextFrame, VisualSummary } from './contracts.js';
const Frame=z.object({at:z.iso.datetime(),sessionId:z.string().max(300),origin:z.string().max(300),tabId:z.number().int().nonnegative(),image:z.object({mediaType:z.enum(['image/png','image/jpeg','image/webp']),base64:z.string().max(700000)}).strict()}).strict();
const Observation=IntervalEvidence.extend({frames:z.array(Frame).max(2)});
const Batch=z.object({v:z.literal(1),kind:z.literal('observe'),seq:z.number().int().positive(),sessionId:z.string().max(300).nullable(),enabled:z.boolean(),tabs:z.array(TabContext).max(200),events:z.array(BrainEvent).max(64),observation:Observation.optional()}).strict();
export function nativeBrainHandler(providers:BrainProviders,onProgress?:(value:unknown)=>void) {
  const brain=new ContextBrain(providers);
  let session:string|null=null,busy=false,contentHash='',lastObservation='';let seen=new Set<string>();
  return async(raw:unknown)=>{
    const batch=Batch.parse(raw);
    if(busy)throw new Error('context-busy');
    if(batch.events.some(event=>event.sessionId!==batch.sessionId))throw new Error('context-session-mismatch');
    const progress=(phase:string)=>onProgress?.({v:1,kind:'brain-progress',seq:batch.seq,sessionId:batch.sessionId,phase,at:new Date().toISOString()});
    const validObservation=batch.observation && batch.observation.id!==lastObservation && batch.enabled;
    if(validObservation && (batch.observation!.frames.some(frame=>frame.sessionId!==batch.sessionId||frame.origin!==batch.observation!.after.origin||frame.tabId!==batch.observation!.tabId||!batch.tabs.some(tab=>tab.tabId===frame.tabId&&tab.origin===frame.origin)||Date.now()-Date.parse(frame.at)>90000||Date.parse(frame.at)>Date.now()+5000) || Date.now()-Date.parse(batch.observation!.at)>90000))throw new Error('context-observation-scope-invalid');
    busy=true;
    try {
      if(batch.sessionId!==session || !batch.sessionId){brain.clear();seen.clear();contentHash='';lastObservation='';session=batch.sessionId;}
      brain.setTabs(batch.tabs);
      if(batch.enabled && batch.sessionId){
        const fresh=batch.events.filter(event=>!seen.has(event.id));
        for(const event of fresh)seen.add(event.id);
        if(seen.size>4000)seen=new Set([...seen].slice(-2000));
        let observation:IntervalEvidence|undefined,frames:ContextFrame[]=[];
        if(validObservation){
          const candidate=batch.observation!;lastObservation=candidate.id;
          const {frames:candidateFrames,...metadata}=candidate;frames=candidateFrames;observation=metadata;
          const evidence=observation;
          if(providers.vision && frames.length){
            progress('Summarizing screenshots');
            try{const summary=await providers.vision(frames);if(summary.mode!==providers.mode)throw new Error();evidence.visualSummary=VisualSummary.parse(summary.value);}catch{evidence.visualSummary=null;}
          }
        }
        // Group evidence by tab, attaching the interval only to its matching document.
        let group:BrainEvent[]=[];let usedObservation=false;
        const flush=async()=>{
          if(!group.length)return;
          progress('Updating task assumption');
          const matches=observation && group.at(-1)!.tabId===observation.tabId && group.at(-1)!.origin===observation.after.origin;
          await brain.observe(group,matches?frames:[],matches?observation:undefined);if(matches)usedObservation=true;group=[];
        };
        for(const event of fresh){
          if(group.length && (group[0].origin!==event.origin||group[0].tabId!==event.tabId))await flush();group.push(event);
        }
        await flush();
        if(observation && !usedObservation){
          progress('Updating interval assumption');
          const tabId=observation.tabId;
          if(tabId!==undefined)await brain.observe([{id:`interval-${observation.id}`,at:observation.at,sessionId:batch.sessionId,origin:observation.after.origin,tabId,provenance:'human',kind:'page-content',tag:'PAGE'}],frames,observation);
        }
        const tab=batch.tabs.find(item=>item.active&&item.readStatus==='ready')??batch.tabs.find(item=>item.readStatus==='ready');
        const hash=tab?createHash('sha256').update(JSON.stringify([tab.tabId,tab.origin,tab.title,tab.headings,tab.excerpt])).digest('hex'):'';
        if(tab && hash!==contentHash){
          contentHash=hash;
          if(!observation && !fresh.some(event=>Date.now()-Date.parse(event.at)<10000 && !['pointer','scroll'].includes(event.kind))){
            progress('Reading page context');await brain.observe([{id:`page-${randomUUID()}`,at:new Date().toISOString(),sessionId:batch.sessionId,origin:tab.origin,tabId:tab.tabId,provenance:'human',kind:'page-content',tag:'PAGE'}]);
          }
        }
      }
      const view=brain.view();
      return {v:1,kind:'brain-state',seq:batch.seq,sessionId:batch.sessionId,state:{...view,journal:view.journal.slice(-40),archived:view.archived.slice(-5),tabs:[],connectedAt:new Date().toISOString(),source:'main-chrome-native'}};
    }finally{busy=false;}
  };
}
