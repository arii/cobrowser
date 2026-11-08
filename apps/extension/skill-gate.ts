import { GateWorkflow } from '../../packages/contracts/src/extension-gate.js';
import { workflowSites } from './skill-workflow.js';

export function gateWorkflow(skill:any) {
  return GateWorkflow.parse({id:skill.id,instruction:skill.instruction??'',sites:workflowSites(skill),steps:skill.steps.map((step:any)=>({kind:step.kind,siteId:step.siteId??'main',parameter:step.parameter??null,target:{tag:step.target?.tag,label:step.target?.label,type:step.target?.type??''}}))});
}
export async function gateRequest(kind:string,skill:any,extra:Record<string,unknown>={}) {
  const stored=await chrome.storage.local.get('skillGateProfileId');
  const profileId=stored.skillGateProfileId??crypto.randomUUID();
  if(!stored.skillGateProfileId)await chrome.storage.local.set({skillGateProfileId:profileId});
  const seq=Date.now();
  let response;
  try {response=await chrome.runtime.sendNativeMessage('com.cobrowser.context',{v:1,kind:`skill-gate:${kind}`,seq,profileId,workflow:gateWorkflow(skill),...extra});}
  catch {throw Object.assign(new Error('Verification host unavailable. Update the native host, then retry. No approval or browser action was authorized.'),{gateFailure:true});}
  if(response?.kind!=='skill-gate:result'||response.seq!==seq||response.ok!==true)throw Object.assign(new Error(response?.message??'The verifier did not authorize this workflow.'),{gateFailure:true});
  return response;
}
