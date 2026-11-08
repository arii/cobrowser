import { SkillRevision, TaskContract, checkContentHash } from '../contracts/src/index.js';
export function validateRevision(input: unknown) { const revision=SkillRevision.parse(input);checkContentHash(revision);return revision; }
export interface ProcedureTransport {
  observe(): Promise<{origin:string}>;
  perform(step: SkillRevision['procedure'][number], value: string | undefined, signal: AbortSignal): Promise<void>;
  detach(): Promise<void>;
}
// Same bounded interpreter for verifier candidates and approved live adapters.
// The caller owns the assigned tab and must implement physical browser input.
export async function executeProcedure(input: unknown, contractInput: unknown, parameters: Record<string,string>, transport: ProcedureTransport, options: {signal?:AbortSignal; authorize:()=>boolean}) {
  const controller=new AbortController();
  const abort=()=>controller.abort();
  options.signal?.addEventListener('abort',abort,{once:true});
  if(options.signal?.aborted)controller.abort();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let actions=0;
  try {
    const revision=validateRevision(input), contract=TaskContract.parse(contractInput); checkContentHash(contract);
    if(revision.contractHash!==contract.contentHash)throw new Error('runtime-contract-mismatch');
    if((revision.requestedCapabilities.includes('input-assigned-tab')&&!contract.allowedEffects.includes('input')) || (revision.requestedCapabilities.includes('download-approved-artifact')&&!contract.allowedEffects.includes('download')))throw new Error('runtime-capability-outside-contract');
    timer=setTimeout(()=>controller.abort(),contract.limits.maxDurationMs);
    const check=()=>{if(controller.signal.aborted)throw new Error('runtime-cancelled-or-timeout');if(!options.authorize())throw new Error('runtime-authorization-revoked');};
    const bounded=async<T>(operation:()=>Promise<T>):Promise<T>=>{
      check();
      let onAbort:()=>void=()=>{};
      try{return await Promise.race([operation(),new Promise<never>((_,reject)=>{onAbort=()=>reject(new Error('runtime-cancelled-or-timeout'));controller.signal.addEventListener('abort',onAbort,{once:true});if(controller.signal.aborted)onAbort();})]);}
      finally{controller.signal.removeEventListener('abort',onAbort);}
    };
    for(const step of revision.procedure){
      check();
      const observation=await bounded(()=>transport.observe());
      if(!contract.allowedOrigins.includes(observation.origin))throw new Error('runtime-origin-outside-contract');
      if(step.kind==='stop')return {status:'controlled-stop' as const,reason:step.reason,actions};
      if(step.kind==='observe')continue;
      if(++actions>contract.limits.maxActions)throw new Error('runtime-action-budget-exhausted');
      if(['click','type','scroll'].includes(step.kind)&&(!revision.requestedCapabilities.includes('input-assigned-tab')||!contract.allowedEffects.includes('input')))throw new Error('runtime-input-not-authorized');
      if(step.kind==='download'&&(!revision.requestedCapabilities.includes('download-approved-artifact')||!contract.allowedEffects.includes('download')))throw new Error('runtime-download-not-authorized');
      const value=step.kind==='type'?parameters[step.parameter]:undefined;
      if(step.kind==='type'&&(typeof value!=='string'||value.length>1000))throw new Error('runtime-input-missing-or-oversized');
      await bounded(()=>transport.perform(step,value,controller.signal));
    }
    check();
    const final=await bounded(()=>transport.observe());
    if(!contract.allowedOrigins.includes(final.origin))throw new Error('runtime-origin-outside-contract');
    return {status:'completed' as const,actions};
  }finally{if(timer)clearTimeout(timer);options.signal?.removeEventListener('abort',abort);controller.abort();await transport.detach();}
}
