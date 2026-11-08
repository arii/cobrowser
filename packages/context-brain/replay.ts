import { digest } from '../model-adapters/context.js';
import type { BrainProviders, CallResult, ContextDecision, SnapSignals } from './contracts.js';
// Explicit synthetic development mode. These rules are not model inference.
export function syntheticContextProviders():BrainProviders {
  const contextModel=process.env.CONTEXT_PROVIDER==='subq'?'subq-preview':process.env.LLAMA_MODEL||'unconfigured-llama';
  const result=<T>(value:T,model:string,input:unknown):CallResult<T>=>({value,model,mode:'replay',latencyMs:0,inputHash:digest(input),usage:{},version:'hand-authored-synthetic-v1'});
  return {
    mode:'replay',contextModel,
    async snap(input) {
      const action=input.events.at(-1)?.kind;
      const editing=input.events.slice(-3).some(event=>event.kind==='change');
      const signals:SnapSignals={taskRelation:input.previous && action==='submit'?'different':'uncertain',relationConfidence:.9,screenChanged:null,actionClass:action==='submit'?'submission':editing?'editing':'inspection',actionConfidence:.9,visualTask:input.images.length?'report_export':'unknown',visualState:input.images.length?'form_entry':'unknown',visualConfidence:input.images.length?.9:0};
      return result(signals,'synthetic-snap',input);
    },
    async vision(frames) {return result({summary:'Synthetic image summary; no model inspected these screenshots.',changes:[],confidence:0},`synthetic-${contextModel}`,{frameCount:frames.length});},
    async context(input) {
      const latest=input.events.filter(event=>!input.freshEventIds || input.freshEventIds.includes(event.id)).at(-1)!;
      const submit=latest.kind==='submit';
      const decision:ContextDecision={intent:submit?'Submit a report request':'Inspect or edit the reporting form',summary:submit?'Recent evidence shows form submission; download success is not established.':'Recent metadata suggests form interaction. Exact goal and field values are unknown.',status:submit && input.previous?'new_task':'continuing',confidence:.85,evidenceIds:[latest.id],explanation:'Synthetic demonstration rule based on the latest event; no model was called.',nextAction:{kind:'unknown',description:'Synthetic preview: no real next-action inference was performed.',targetTabId:null,confidence:0,evidenceIds:[latest.id]}};
      return result(decision,`synthetic-${contextModel}`,input);
    },
  };
}
