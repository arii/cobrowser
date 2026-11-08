import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { ActionRequest, ObservationEvent, SkillRevision, VerificationReport, Timezone, canonicalJSON, contentHash, newId } from '../packages/contracts/src/index.js';
import { validateAction, screenshotToCSS, type BrowserObservation } from '../packages/browser-adapters/src/index.js';
import { synthetic } from './fixtures/synthetic.js';
test('canonical hashes preserve meaning, reject non-JSON and strict schemas exclude executable skills', () => {
  assert.equal(contentHash({b:2,a:1}),createHash('sha256').update('{"a":1,"b":2}').digest('hex'));
  assert.equal(contentHash({a:1,b:2}),contentHash({b:2,a:1}));
  assert.notEqual(contentHash([1,2]),contentHash([2,1]));
  assert.throws(()=>canonicalJSON({bad:undefined}));
  assert.throws(()=>canonicalJSON({bad:Infinity}));
  const data=synthetic();
  assert.throws(()=>SkillRevision.parse({...data.revision,procedure:[{kind:'javascript',source:'fetch("/export")'}]}));
  assert.throws(()=>SkillRevision.parse({...data.revision,active:true}));
  assert.throws(()=>ObservationEvent.parse({...data.event,schemaVersion:2}));
  assert.throws(()=>ObservationEvent.parse({...data.event,target:{...data.event.target,sensitive:true}}));
  assert.throws(()=>Timezone.parse('machine-default'));
  assert.notEqual(newId(),newId());
});
test('stale, expired, off-tab, wrong-document and out-of-bounds actions are rejected in measured CSS coordinates', () => {
  const now=new Date('2026-11-07T20:00:00.000Z');
  const observation:BrowserObservation={runId:newId(),sessionId:newId(),tabId:1,windowId:1,documentId:'document-1',origin:'http://127.0.0.1:3210',sequence:1,observedAt:now.toISOString(),cssWidth:800,cssHeight:600,screenshotWidth:2000,screenshotHeight:1500};
  const action=ActionRequest.parse({schemaVersion:1,id:newId(),runId:observation.runId,sessionId:observation.sessionId,tabId:1,windowId:1,documentId:'document-1',origin:observation.origin,
    observationSequence:1,createdAt:now.toISOString(),expiresAt:new Date(+now+1000).toISOString(),action:{kind:'click',x:799,y:599}});
  assert.equal(validateAction(action,observation,now).id,action.id);
  assert.throws(()=>validateAction(action,{...observation,cssWidth:NaN},now),/invalid-observation-context/);
  assert.throws(()=>validateAction(action,{...observation,observedAt:'invalid'},now),/invalid-observation-context/);
  assert.deepEqual(screenshotToCSS(1000,750,observation),{x:400,y:300});
  assert.throws(()=>validateAction({...action,tabId:2},observation,now),/scope-mismatch/);
  assert.throws(()=>validateAction({...action,runId:newId()},observation,now),/scope-mismatch/);
  assert.throws(()=>validateAction({...action,documentId:'navigated'},observation,now),/scope-mismatch/);
  assert.throws(()=>validateAction({...action,observationSequence:2},observation,now),/sequence-mismatch/);
  assert.throws(()=>validateAction(action,observation,new Date(+now+1000)),/stale/);
  assert.throws(()=>validateAction({...action,action:{kind:'click',x:800,y:0}},observation,now),/outside-viewport/);
});
test('report schemas cannot approve deterministic failures or missing required assertions', () => {
  const report={schemaVersion:1,id:newId(),candidateHash:'a'.repeat(64),contractHash:'b'.repeat(64),suiteHash:'c'.repeat(64),environmentHash:'d'.repeat(64),runtimeHash:'e'.repeat(64),verdict:'approved',assertions:[{id:'csv',required:true,result:'failed'}],modelRequestRefs:[],evidenceHashes:[],failures:[],completedAt:new Date().toISOString(),authentication:{keyId:'supervisor-v1',algorithm:'hmac-sha256',signature:'f'.repeat(64)}};
  assert.throws(()=>VerificationReport.parse(report));
  assert.throws(()=>VerificationReport.parse({...report,assertions:[{id:'csv',required:true,result:'missing'}]}));
  // A structurally valid report is not authenticated by this parse. Phase 2 owns signature verification.
  assert.equal(VerificationReport.parse({...report,verdict:'blocked'}).verdict,'blocked');
});
