import { mkdirSync, lstatSync, readFileSync, writeFileSync, renameSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import { GateRequest, type GateWorkflow, type ReportingTask } from '../../packages/contracts/src/extension-gate.js';
import { contentHash, newId, seal, SkillRevision, TaskContract, VerificationSuite, type VerificationAuthority } from '../../packages/contracts/src/index.js';
import { HarnessStore } from '../../packages/storage/src/index.js';
import { previousWeek } from '../verifier/oracle.js';
import { verifyExtensionWorkflow, reportingEnvironment } from '../verifier/extension-runner.js';

const Entry=z.object({bindingHash:z.string(),revisionId:z.uuid(),suiteId:z.uuid(),task:z.object({family:z.literal('synthetic-weekly-report-v1'),team:z.enum(['red','blue']),asOf:z.string(),timezone:z.string()}),enabled:z.boolean()}).strict();
const State=z.object({version:z.literal(1),entries:z.record(z.string(),Entry),lease:z.object({runId:z.uuid(),skillId:z.uuid(),bindingHash:z.string(),generation:z.number().int(),deadline:z.number(),step:z.number().int(),checks:z.number().int()}).strict().nullable()}).strict();
type State=z.infer<typeof State>;
function privateDirectory(path:string){mkdirSync(path,{recursive:true,mode:0o700});const st=lstatSync(path);if(!st.isDirectory()||st.isSymbolicLink()||st.uid!==process.getuid?.()||(st.mode&0o077))throw new Error('gate-storage-permissions');}
function privateFile(path:string){const st=lstatSync(path);if(!st.isFile()||st.isSymbolicLink()||st.uid!==process.getuid?.()||(st.mode&0o077)||st.size>1024*1024)throw new Error('gate-storage-permissions');}
function readState(path:string):State{try{privateFile(path);return State.parse(JSON.parse(readFileSync(path,'utf8')));}catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return {version:1,entries:{},lease:null};throw error;}}
function saveState(path:string,state:State){const temp=path+'.'+newId();writeFileSync(temp,JSON.stringify(state),{mode:0o600,flag:'wx'});try{renameSync(temp,path);}finally{try{unlinkSync(temp);}catch{ /* renamed */ }}}
function readKey(path:string){try{writeFileSync(path,randomBytes(32),{mode:0o600,flag:'wx'});}catch(error){if((error as NodeJS.ErrnoException).code!=='EEXIST')throw error;}privateFile(path);const key=readFileSync(path);if(key.length!==32)throw new Error('gate-key-invalid');return key;}
function reportingScope(workflow:GateWorkflow){
  if(workflow.sites.length!==1)throw new Error('gate-unsupported-workflow');
  const site=workflow.sites[0],url=new URL(site.url);
  if(url.protocol!=='http:'||url.hostname!=='127.0.0.1'||url.pathname!=='/'||url.search||url.hash||url.username||url.password)throw new Error('gate-unsupported-workflow');
  const parameters=new Set();
  for(const step of workflow.steps){
    if(step.siteId!==site.id)throw new Error('gate-unsupported-workflow');
    if(step.kind==='change'){
      if(!step.parameter||parameters.has(step.parameter)||!['Team','Start inclusive','End exclusive'].includes(step.target.label))throw new Error('gate-unsupported-workflow');parameters.add(step.parameter);
    }else if(step.target.tag!=='BUTTON'||step.target.label!=='Export CSV'||step.parameter!==null)throw new Error('gate-unsupported-workflow');
  }
  return url.origin;
}
function runParameters(workflow:GateWorkflow,task:ReportingTask){const range=previousWeek(task),values:Record<string,string>={Team:task.team,'Start inclusive':range.start,'End exclusive':range.end};return Object.fromEntries(workflow.steps.filter(step=>step.kind==='change').map(step=>[step.parameter!,values[step.target.label]]));}
const messages:Record<string,string>={
  'gate-unsupported-workflow':'No independent verifier supports this workflow yet. Only the local synthetic weekly CSV report can be activated.',
  'gate-no-approval':'This workflow has no current independent approval. Verify and activate it first.',
  'gate-workflow-changed':'The workflow changed after verification. Review and verify it again.',
  'gate-inputs-changed':'This run differs from the verified task. Reverify the skill with the intended team, week and timezone.',
  'gate-run-unavailable':'The run authorization expired, was revoked, or belongs to another run. No further action is authorized.',
  'gate-busy':'Another authorized run is active. Stop it or wait for its authorization to expire.',
};
export interface GateResponse {v:number;kind:string;seq:number;ok:boolean;code?:string;message?:string;[key:string]:unknown}
export function extensionGateHandler(options:{root:string;runtimeHash:string}){
  return async(raw:unknown):Promise<GateResponse>=>{
    const parsed=GateRequest.safeParse(raw);
    if(!parsed.success)return {v:1,kind:'skill-gate:result',seq:(raw as any)?.seq??0,ok:false,code:'gate-invalid-request',message:'The verification request is invalid.'};
    const request=parsed.data;
    let store:HarnessStore|undefined,key:Buffer|undefined;
    try{
      privateDirectory(options.root);
      const root=join(options.root,request.profileId);privateDirectory(root);
      store=await HarnessStore.openUnencrypted(join(root,'store'));
      key=readKey(join(root,'authority.key'));
      const authority:VerificationAuthority={keyId:'local-extension-supervisor-v1',key,environmentHash:contentHash({platform:process.platform,arch:process.arch,node:process.version,scope:'synthetic-reporting-v1',...reportingEnvironment()}),runtimeHash:options.runtimeHash};
      const path=join(root,'state.json'),state=readState(path),workflow=request.workflow,bindingHash=contentHash(workflow);
      const entry=state.entries[workflow.id];
      const respond=(extra:Record<string,unknown>={})=>({v:1,kind:'skill-gate:result',seq:request.seq,ok:true,...extra});
      if(request.kind==='skill-gate:deactivate'){
        if(entry)entry.enabled=false;
        if(state.lease?.skillId===workflow.id)state.lease=null;
        saveState(path,state);return respond({status:'inactive'});
      }
      if(request.kind==='skill-gate:activate'){
        const origin=reportingScope(workflow);
        if(state.lease&&state.lease.deadline>Date.now())throw new Error('gate-busy');
        const task=request.task;
        // Refuse dates outside the public independent oracle's known dataset.
        const range=previousWeek(task);if(!['2026-10-19','2026-10-26'].includes(range.start))throw new Error('gate-task-outside-fixture-dataset');
        const contract=TaskContract.parse(seal({schemaVersion:1,id:newId(),version:1,inputSchema:{task,bindingHash},timezone:task.timezone,previousWeek:'monday-to-monday-end-exclusive',allowedOrigins:[origin],allowedEffects:['navigate','input','download'],artifactAssertions:['csv-exact-rows'],stateAssertions:['permitted-effects'],semanticCriteria:[],controlledStopRules:['unsupported-state'],limits:{maxActions:48,maxDurationMs:30000,maxModelCalls:0,maxArtifactBytes:1048576}}));
        store.putTaskContract(contract);
        const suite=VerificationSuite.parse(seal({schemaVersion:1,id:newId(),version:1,contractHash:contract.contentHash,frozenAt:new Date().toISOString(),scenarioSeeds:[1,2,3,4,5,6,7,8,9,10],mutations:['none'],oracleIds:['independent-csv-v1'],requiredAssertions:['csv-exact-rows','permitted-effects','scenario-coverage']}));store.putVerificationSuite(suite);
        const now=new Date().toISOString();
        const active=store.getActiveSkill(workflow.id);
        const revision=SkillRevision.parse(seal({schemaVersion:1,id:newId(),skillId:workflow.id,parentHash:active.revision?.contentHash??null,contractHash:contract.contentHash,createdAt:now,parameterSchema:{$extensionWorkflow:workflow},procedure:workflow.steps.map((step,index)=>step.kind==='change'?{kind:'type',target:String(index),parameter:step.parameter}:{kind:'download',target:String(index)}),requestedCapabilities:['observe-approved-tab','input-assigned-tab','download-approved-artifact'],demonstrationIds:[],reviewedImport:{bindingHash,reviewedAt:now},generator:{provider:'meta-llama',model:'hand-authored-extension-adapter',promptVersion:'synthetic-bound-workflow-v1',mode:'replay'}}));
        store.putRevision(revision);store.transitionRevision(revision.id,'draft','queued',0);store.transitionRevision(revision.id,'queued','verifying',1);
        const report=await verifyExtensionWorkflow(workflow,task,revision,contract,suite,authority);
        const result=store.applyVerification(report,{revisionId:revision.id,suiteId:suite.id,revisionGeneration:2,activeGeneration:active.generation,userConfirmed:request.reviewed},authority);
        if(report.verdict!=='approved')return respond({status:report.verdict,approval:{candidateHash:revision.contentHash,bindingHash,verdict:report.verdict,assertions:report.assertions},message:report.verdict==='blocked'?'Independent CSV or effect checks blocked this workflow. The previous approved revision is preserved.':'Verification is inconclusive. Check the host browser installation and task scope; activation was not granted.'});
        state.entries[workflow.id]={bindingHash,revisionId:revision.id,suiteId:suite.id,task,enabled:true};saveState(path,state);
        return respond({status:'approved',approval:{candidateHash:revision.contentHash,bindingHash,verdict:'approved',verifiedAt:report.completedAt,normalRuns:10},generation:result.generation,task,parameters:runParameters(workflow,task)});
      }
      if(!entry?.enabled)throw new Error('gate-no-approval');
      if(entry.bindingHash!==bindingHash)throw new Error('gate-workflow-changed');
      const active=store.authorizeActiveSkill(workflow.id,entry.suiteId,authority);
      if(active.revision?.id!==entry.revisionId)throw new Error('gate-no-approval');
      if(request.kind==='skill-gate:begin'){
        if(request.instruction!==workflow.instruction)throw new Error('gate-inputs-changed');
        const parameters=runParameters(workflow,entry.task);
        if(Object.entries(request.parameters).some(([name,value])=>parameters[name]!==value))throw new Error('gate-inputs-changed');
        if(state.lease&&state.lease.deadline>Date.now())throw new Error('gate-busy');
        const deadline=Date.now()+Math.min(active.contract.limits.maxDurationMs*10,300000);
        state.lease={runId:request.runId,skillId:workflow.id,bindingHash,generation:active.generation,deadline,step:0,checks:0};saveState(path,state);
        return respond({status:'authorized',parameters,task:entry.task,deadline,candidateHash:active.revision.contentHash});
      }
      const lease=state.lease;
      if(!lease||lease.runId!==request.runId||lease.skillId!==workflow.id||lease.bindingHash!==bindingHash||lease.generation!==active.generation||lease.deadline<=Date.now())throw new Error('gate-run-unavailable');
      if(request.kind==='skill-gate:finish'){state.lease=null;saveState(path,state);return respond({status:'closed'});}
      if(request.kind==='skill-gate:check'){
        if(request.step<lease.step||request.step>lease.step+1||request.step>workflow.steps.length||lease.checks>=256)throw new Error('gate-run-unavailable');
        lease.step=request.step;lease.checks++;saveState(path,state);return respond({status:'authorized',candidateHash:active.revision.contentHash});
      }
      throw new Error('gate-invalid-request');
    }catch(error){
      const code=error instanceof Error&&/^[a-z0-9-]+$/.test(error.message)?error.message:'gate-verification-unavailable';
      return {v:1,kind:'skill-gate:result',seq:request.seq,ok:false,code,message:messages[code]??'Independent verification is unavailable or incompatible. No browser action was authorized; retry verification after resolving host setup.'};
    }finally{store?.close();key?.fill(0);}
  };
}
