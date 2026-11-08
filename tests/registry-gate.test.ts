import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { HarnessStore } from '../packages/storage/src/index.js';
import { VerificationSuite, seal, newId, signReport, type VerificationReport } from '../packages/contracts/src/index.js';
import { SkillRegistry } from '../services/registry/index.js';
import { synthetic } from './fixtures/synthetic.js';

async function registryFixture() {
  const root = await mkdtemp(join(tmpdir(), 'cobrowser-registry-'));
  const now = Date.now();
  const data = synthetic(new Date(now - 1000).toISOString());
  let store = await HarnessStore.openUnencrypted(root, { now: () => now });
  store.putFrame(data.frame, data.bytes); store.putEvent(data.event); store.putDemonstration(data.demonstration); store.putTaskContract(data.contract);
  const suite = VerificationSuite.parse(seal({ schemaVersion: 1, id: newId(), version: 1, contractHash: data.contract.contentHash, frozenAt: data.revision.createdAt, scenarioSeeds: [1], mutations: ['none','wrong-week','wrong-team'], oracleIds: ['independent-csv-v1'], requiredAssertions: ['csv-exact-rows','permitted-effects'] }));
  store.putVerificationSuite(suite);
  const authority = { keyId: 'test-supervisor', key: randomBytes(32), environmentHash: 'a'.repeat(64), runtimeHash: 'b'.repeat(64) };
  function candidate(parent = data.revision.contentHash, target = 'Export') {
    const { contentHash: _hash, ...body } = data.revision;
    return seal({ ...body, id: newId(), parentHash: parent, procedure: [{ kind: 'download' as const, target }] });
  }
  function queue(revision = data.revision) {
    store.putRevision(revision);
    store.transitionRevision(revision.id, 'draft','queued',0);
    store.transitionRevision(revision.id, 'queued','verifying',1);
    return revision;
  }
  function report(revision = data.revision, verdict: VerificationReport['verdict'] = 'approved', overrides: Partial<Omit<VerificationReport,'authentication'>> = {}) {
    return signReport({ schemaVersion: 1, id: newId(), candidateHash: revision.contentHash, contractHash: data.contract.contentHash, suiteHash: suite.contentHash, environmentHash: authority.environmentHash, runtimeHash: authority.runtimeHash, verdict, assertions: [{id:'csv-exact-rows',required:true,result: verdict === 'blocked' ? 'failed' : verdict === 'inconclusive' ? 'missing' : 'passed'}, {id:'permitted-effects',required:true,result:'passed'}], modelRequestRefs: [], evidenceHashes: ['c'.repeat(64)], failures: verdict === 'blocked' ? ['Wrong report'] : [], completedAt: new Date(now).toISOString(), ...overrides }, authority);
  }
  function apply(input = report(), revision = data.revision, activeGeneration = 0, userConfirmed = true) {
    return store.applyVerification(input, {revisionId:revision.id,suiteId:suite.id,revisionGeneration:2,activeGeneration,userConfirmed}, authority);
  }
  return { data, suite, authority, candidate, queue, report, apply, get store() {return store;}, async reopen() { store.close(); store = await HarnessStore.openUnencrypted(root, {now:()=>now}); }, async close() {store.close();await rm(root,{recursive:true,force:true});} };
}

test('only authenticated exact-context reports with complete evidence can atomically activate a reviewed revision', async () => {
  const f = await registryFixture();
  try {
    f.queue();
    const good = f.report();
    assert.throws(()=>f.apply({...good,evidenceHashes:['d'.repeat(64)]}),/authentication/);
    assert.throws(()=>f.apply(f.report(undefined,'approved',{runtimeHash:'f'.repeat(64)})),/context-mismatch/);
    assert.throws(()=>f.apply(f.report(undefined,'approved',{candidateHash:'f'.repeat(64)})),/context-mismatch/);
    assert.throws(()=>f.apply(f.report(undefined,'approved',{suiteHash:'f'.repeat(64)})),/context-mismatch/);
    assert.throws(()=>f.apply(f.report(undefined,'approved',{evidenceHashes:[]})),/evidence-missing/);
    assert.throws(()=>f.apply(f.report(undefined,'approved',{assertions:[{id:'csv-exact-rows',required:true,result:'passed'}]})),/required-assertion-missing/);
    assert.throws(()=>f.apply(f.report(undefined,'approved',{assertions:[{id:'csv-exact-rows',required:true,result:'passed'},{id:'csv-exact-rows',required:true,result:'passed'}]})),/duplicate/);
    assert.throws(()=>f.apply(good,undefined,0,false),/user-review/);
    assert.throws(()=>f.apply(good,undefined,1),/stale-active/);
    assert.equal(f.store.getRegistryAudit(f.data.revision.skillId).length,0);
    assert.equal(f.store.getRevision(f.data.revision.id)?.state,'verifying');
    assert.equal(f.apply(good).revision?.contentHash,f.data.revision.contentHash);
    assert.throws(()=>f.apply(good),/stale-revision/);
    await f.reopen();
    assert.equal(f.store.getActiveSkill(f.data.revision.skillId).revision?.id,f.data.revision.id);
    assert.equal(f.store.getRegistryAudit(f.data.revision.skillId).length,1);
  } finally {await f.close();}
});

test('blocked and inconclusive candidates preserve active revision; competing promotion loses its generation race', async () => {
  const f = await registryFixture();
  try {
    f.queue(); f.apply();
    for (const verdict of ['blocked','inconclusive'] as const) {
      const next=f.queue(f.candidate());
      assert.equal(f.apply(f.report(next,verdict),next,1).revision?.id,f.data.revision.id);
      assert.equal(f.store.getRevision(next.id)?.state,verdict);
    }
    const a=f.queue(f.candidate()), b=f.queue(f.candidate());
    f.apply(f.report(a),a,1);
    assert.throws(()=>f.apply(f.report(b),b,1),/stale-active/);
    assert.equal(f.store.getRevision(b.id)?.state,'verifying');
  } finally {await f.close();}
});

test('trusted regression quarantines current version, restores compatible approval and survives restart', async () => {
  const f=await registryFixture();
  try {
    f.queue(); f.apply();
    const next=f.queue(f.candidate()); f.apply(f.report(next),next,1);
    const options={revisionId:next.id,suiteId:f.suite.id,activeGeneration:2};
    assert.throws(()=>f.store.quarantineAndRollback(f.report(next),options,f.authority),/failed-assertion/);
    const result=f.store.quarantineAndRollback(f.report(next,'blocked'),options,f.authority);
    assert.equal(result.revision?.id,f.data.revision.id);
    assert.equal(result.generation,3);
    assert.throws(()=>f.store.quarantineAndRollback(f.report(next,'blocked'),options,f.authority),/stale-active/);
    await f.reopen();
    assert.equal(f.store.getActiveSkill(next.skillId).revision?.id,f.data.revision.id);
    assert.equal(f.store.getRegistryAudit(next.skillId).length,3);
  } finally {await f.close();}
});

test('regression without compatible fallback disables execution; deleted source evidence invalidates activation', async () => {
  const f=await registryFixture();
  try {
    f.queue(); f.apply();
    assert.equal(f.store.quarantineAndRollback(f.report(undefined,'blocked'),{revisionId:f.data.revision.id,suiteId:f.suite.id,activeGeneration:1},f.authority).revision,null);
    assert.equal(f.store.getActiveSkill(f.data.revision.skillId).revision,null);
  } finally {await f.close();}
  const g=await registryFixture();
  try {
    g.queue();g.apply();g.store.deleteDemonstration(g.data.demonstration.id);
    assert.equal(g.store.getActiveSkill(g.data.revision.skillId).revision,null);
  } finally {await g.close();}
});


test('execution authorization rejects approvals from a different runtime and revoked evidence', async () => {
  const f=await registryFixture();
  try {
    f.queue();f.apply();
    assert.equal(f.store.authorizeActiveSkill(f.data.revision.skillId,f.suite.id,f.authority).revision?.id,f.data.revision.id);
    assert.throws(()=>f.store.authorizeActiveSkill(f.data.revision.skillId,f.suite.id,{...f.authority,runtimeHash:'f'.repeat(64)}),/context-mismatch/);
    f.store.deleteDemonstration(f.data.demonstration.id);
    assert.throws(()=>f.store.authorizeActiveSkill(f.data.revision.skillId,f.suite.id,f.authority),/no-approved-active/);
  } finally {await f.close();}
});


test('registry execution requires user activation and stops when trusted quarantine revokes approval', async () => {
  const f=await registryFixture();
  let performed=0,detached=0;
  const registry=new SkillRegistry(f.store,f.authority);
  const transport={observe:async()=>({origin:f.data.contract.allowedOrigins[0]}),perform:async()=>{performed++;f.store.quarantineAndRollback(f.report(undefined,'blocked'),{revisionId:f.data.revision.id,suiteId:f.suite.id,activeGeneration:1},f.authority);},detach:async()=>{detached++;}};
  try {
    await assert.rejects(registry.execute(f.data.revision.skillId,f.suite.id,{},transport,{userConfirmed:false}),/user-activation/);
    await assert.rejects(registry.execute(f.data.revision.skillId,f.suite.id,{},transport,{userConfirmed:true}),/no-approved-active/);
    assert.equal(performed,0);assert.equal(detached,2);
    f.queue();f.apply();
    await assert.rejects(registry.execute(f.data.revision.skillId,f.suite.id,{},transport,{userConfirmed:true}),/authorization-revoked/);
    assert.equal(performed,1);assert.equal(detached,3);
  }finally{await f.close();}
});
