import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { GateRequest, GateWorkflow } from '../packages/contracts/src/extension-gate.js';
import { contentHash, newId, seal, SkillRevision } from '../packages/contracts/src/index.js';
import { extensionGateHandler } from '../services/registry/extension-gate.js';
import { HarnessStore } from '../packages/storage/src/index.js';
import { synthetic } from './fixtures/synthetic.js';

function workflow(){return GateWorkflow.parse({id:newId(),instruction:'Preview a report',sites:[{id:'main',url:'http://127.0.0.1:3210/'}],steps:[{kind:'click',siteId:'main',parameter:null,target:{tag:'BUTTON',label:'Preview report',type:'button'}}]});}
test('native gate validates review, profile and protocol; unsupported workflows cannot obtain approval',async()=>{
  const root=await mkdtemp(join(tmpdir(),'cobrowser-gate-unit-'));
  try{
    const gate=extensionGateHandler({root,runtimeHash:'a'.repeat(64)}),flow=workflow();
    const request={v:1,seq:1,profileId:newId(),kind:'skill-gate:activate',workflow:flow,reviewed:true,task:{family:'synthetic-weekly-report-v1',team:'red',asOf:'2026-11-07T20:00:00Z',timezone:'America/Los_Angeles'}};
    assert.equal(GateRequest.safeParse({...request,reviewed:false}).success,false);
    assert.equal(GateRequest.safeParse({...request,profileId:'../../other'}).success,false);
    assert.equal(GateRequest.safeParse({...request,report:{verdict:'approved'}}).success,false);
    const refused=await gate(request);assert.equal(refused.ok,false);assert.equal(refused.code,'gate-unsupported-workflow');
    const noApproval=await gate({v:1,seq:2,profileId:request.profileId,kind:'skill-gate:begin',workflow:flow,runId:newId(),parameters:{},instruction:flow.instruction});
    assert.equal(noApproval.ok,false);assert.equal(noApproval.code,'gate-no-approval');
    const invalid=await gate({...request,workflow:{...flow,active:true}});assert.equal(invalid.ok,false);
  }finally{await rm(root,{recursive:true,force:true});}
});
test('workflow hashes bind every execution field and reject executable extras',()=>{
  const flow=workflow(),hash=contentHash(flow);
  for(const changed of [{...flow,instruction:'Different intent'},{...flow,sites:[{...flow.sites[0],url:'http://127.0.0.1:3211/'}]},{...flow,steps:[{...flow.steps[0],target:{...flow.steps[0].target,label:'Export CSV'}}]}])assert.notEqual(contentHash(GateWorkflow.parse(changed)),hash);
  assert.equal(GateWorkflow.safeParse({...flow,steps:[{...flow.steps[0],script:'fetch("/export")'}]}).success,false);
});
test('reviewed imports bind their exact workflow without fabricating human demonstration provenance',async()=>{
  const root=await mkdtemp(join(tmpdir(),'cobrowser-import-')),store=await HarnessStore.openUnencrypted(root);
  try{
    const data=synthetic(),flow=workflow();store.putTaskContract(data.contract);
    const {contentHash:_hash,...body}=data.revision;
    assert.equal(SkillRevision.safeParse(seal({...body,demonstrationIds:[]})).success,false);
    const imported=seal({...body,demonstrationIds:[],parameterSchema:{$extensionWorkflow:flow},reviewedImport:{bindingHash:contentHash(flow),reviewedAt:new Date().toISOString()}});
    assert.throws(()=>store.putRevision(seal({...body,demonstrationIds:[],parameterSchema:{$extensionWorkflow:flow},reviewedImport:{bindingHash:'a'.repeat(64),reviewedAt:new Date().toISOString()}})),/binding-mismatch/);
    store.putRevision(imported);assert.equal(store.getRevision(imported.id)?.state,'draft');
    assert.equal(store.getRevision(imported.id)?.revision.demonstrationIds.length,0);
    assert.equal(store.getActiveSkill(imported.skillId).revision,null);
  }finally{store.close();await rm(root,{recursive:true,force:true});}
});
