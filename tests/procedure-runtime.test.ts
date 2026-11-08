import { test } from 'node:test';
import assert from 'node:assert/strict';
import { executeProcedure, type ProcedureTransport } from '../packages/skill-runtime/index.js';
import { seal } from '../packages/contracts/src/index.js';
import { synthetic } from './fixtures/synthetic.js';

function setup() {
  const data=synthetic();let performed=0,detached=0,origin=data.contract.allowedOrigins[0];
  const transport:ProcedureTransport={observe:async()=>({origin}),perform:async()=>{performed++;},detach:async()=>{detached++;}};
  return {data,transport,get performed(){return performed;},get detached(){return detached;},setOrigin(value:string){origin=value;}};
}
test('shared interpreter rejects unauthorized, cancelled and out-of-origin runs before browser input',async()=>{
  for(const mode of ['unauthorized','cancelled','origin']){
    const f=setup(),controller=new AbortController();if(mode==='cancelled')controller.abort();if(mode==='origin')f.setOrigin('https://unlisted.example');
    await assert.rejects(executeProcedure(f.data.revision,f.data.contract,{},f.transport,{signal:controller.signal,authorize:()=>mode!=='unauthorized'}),/runtime-/);
    assert.equal(f.performed,0);assert.equal(f.detached,1);
  }
});
test('shared interpreter rechecks approval after actions and never claims success after scope changes',async()=>{
  const f=setup();f.transport.perform=async()=>{f.setOrigin('https://unlisted.example');};
  await assert.rejects(executeProcedure(f.data.revision,f.data.contract,{},f.transport,{authorize:()=>true}),/origin-outside/);
  assert.equal(f.detached,1);
  const g=setup();
  await assert.rejects(executeProcedure(g.data.revision,g.data.contract,{},g.transport,{authorize:()=>g.performed===0}),/authorization-revoked/);
  assert.equal(g.performed,1);assert.equal(g.detached,1);
});
test('shared interpreter enforces action budgets, missing input and a deadline on hung adapters',async()=>{
  const f=setup();const {contentHash:_hash,...body}=f.data.contract;
  const contract=seal({...body,limits:{...body.limits,maxActions:1,maxDurationMs:20}});
  const {contentHash:_revisionHash,...revisionBody}=f.data.revision;
  const revision=seal({...revisionBody,contractHash:contract.contentHash,procedure:[{kind:'download',target:'Export'},{kind:'download',target:'Export'}]});
  await assert.rejects(executeProcedure(revision,contract,{},f.transport,{authorize:()=>true}),/action-budget/);assert.equal(f.performed,1);
  const g=setup();g.transport.perform=async()=>new Promise(()=>{});
  await assert.rejects(executeProcedure(revision,contract,{},g.transport,{authorize:()=>true}),/cancelled-or-timeout/);assert.equal(g.detached,1);
  const h=setup();const input=seal({...revisionBody,contractHash:h.data.contract.contentHash,requestedCapabilities:['input-assigned-tab'],procedure:[{kind:'type',target:'Team',parameter:'team'}]});
  await assert.rejects(executeProcedure(input,h.data.contract,{},h.transport,{authorize:()=>true}),/input-missing/);assert.equal(h.performed,0);
});
