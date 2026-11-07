import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readdir, readFile, writeFile, chmod } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import Database from 'better-sqlite3';
import { HarnessStore, EphemeralKeyProvider } from '../packages/storage/src/index.js';
import { ExecutionRun, newId, seal } from '../packages/contracts/src/index.js';
import { synthetic } from './fixtures/synthetic.js';
const initial = Date.parse('2026-11-07T20:00:00.000Z');
async function setup() {
  const root = await mkdtemp(join(tmpdir(), 'harness-storage-'));
  let now = initial;
  const key = new EphemeralKeyProvider();
  const store = await HarnessStore.open(root, key, { now: () => now });
  const data = synthetic();
  const seed = () => { store.putTaskContract(data.contract);store.putFrame(data.frame,data.bytes); store.putEvent(data.event); store.putDemonstration(data.demonstration); store.putRevision(data.revision); };
  return { root, key, store, data, seed, advance: (ms: number) => { now += ms; }, now: () => now,
    cleanup: async () => { store.close(); await rm(root,{recursive:true,force:true}); } };
}
test('synthetic evidence survives reopen, is encrypted on disk, expires and invalidates immutable derived revisions', async () => {
  const t = await setup();
  try {
    t.seed();
    assert.deepEqual(t.store.getDemonstration(t.data.demonstration.id),t.data.demonstration);
    assert.deepEqual(t.store.readArtifact(t.data.frame.encryptionRef.artifactId),t.data.bytes);
    t.store.close();
    const reopened = await HarnessStore.open(t.root,t.key,{now:t.now});
    try {
      assert.deepEqual(reopened.getRevision(t.data.revision.id)?.revision,t.data.revision);
      for (const dir of [t.root,join(t.root,'artifacts')]) for (const file of await readdir(dir,{withFileTypes:true})) {
        if (!file.isFile()) continue;
        const bytes=await readFile(join(dir,file.name));
        assert.equal(bytes.includes(t.data.bytes),false);
        assert.equal(bytes.includes(Buffer.from('SYNTHETIC_PRIVATE_PARAMETER')),false);
      }
      t.advance(86400001);
      // Reads fail closed even before the periodic retention sweep runs.
      assert.throws(()=>reopened.getDemonstration(t.data.demonstration.id),/source-evidence-unavailable/);
      reopened.expire();
      assert.equal(reopened.getEvent(t.data.event.id),null);
      assert.equal(reopened.getFrame(t.data.frame.id),null);
      assert.throws(()=>reopened.getDemonstration(t.data.demonstration.id),/source-evidence-unavailable/);
      assert.equal(reopened.getRevision(t.data.revision.id)?.stale,true);
      assert.deepEqual(reopened.getRevision(t.data.revision.id)?.revision,t.data.revision);
      // Privacy deletion still works when the demonstration's sources are already gone.
      reopened.deleteDemonstration(t.data.demonstration.id);
      assert.equal(reopened.getDemonstration(t.data.demonstration.id),null);
      reopened.deleteEvidence(t.data.revision.id);
      reopened.deleteEvidence(t.data.contract.id);
      assert.deepEqual(reopened.stats(),{records:0,artifacts:0,bytes:0});
      assert.deepEqual(await readdir(join(t.root,'artifacts')),[]);
    } finally { reopened.close(); }
  } finally { await t.cleanup(); }
});
test('privacy deletion removes owned evidence and files, held-out/agent evidence cannot train, and duplicate revisions cannot mutate', async () => {
  const t=await setup();
  try {
    t.seed();
    assert.throws(()=>t.store.putRevision(t.data.revision),/immutable/);
    assert.throws(()=>t.store.putRevision({...t.data.revision,procedure:[{kind:'stop',reason:'tamper'}]}),/content-hash-mismatch/);
    const agent={...t.data.event,id:newId(),provenance:'agent'};
    t.store.putEvent(agent);
    assert.throws(()=>t.store.putDemonstration({...t.data.demonstration,id:newId(),eventIds:[agent.id],outcome:{...t.data.demonstration.outcome,evidenceIds:[agent.id]}}),/human-events/);
    const heldout={...t.data.demonstration,id:newId(),assignment:'held-out'};
    t.store.putDemonstration(heldout);
    const {contentHash:_hash,...unhashed}=t.data.revision;
    assert.throws(()=>t.store.putRevision(seal({...unhashed,id:newId(),demonstrationIds:[heldout.id]})),/training-demonstration/);
    t.store.deleteDemonstration(t.data.demonstration.id);
    assert.equal(t.store.getEvent(t.data.event.id),null);
    assert.equal(t.store.getFrame(t.data.frame.id),null);
    assert.throws(()=>t.store.readArtifact(t.data.frame.encryptionRef.artifactId),/unavailable/);
    assert.equal(t.store.getRevision(t.data.revision.id)?.stale,true);
  } finally { await t.cleanup(); }
});
test('authenticated encryption rejects tampering and wrong keys; quotas and exclusive writer fail closed', async () => {
  const t=await setup();
  try {
    t.seed();
    await assert.rejects(HarnessStore.open(t.root,t.key),/already-open/);
    const path=join(t.root,'artifacts',`${t.data.frame.encryptionRef.artifactId}.enc`);
    const bytes=await readFile(path);bytes[bytes.length-1]^=1;await writeFile(path,bytes);
    assert.throws(()=>t.store.readArtifact(t.data.frame.encryptionRef.artifactId),/authentication-failed/);
    t.store.close();
    const wrong=await HarnessStore.open(t.root,new EphemeralKeyProvider(),{now:t.now});
    try { assert.throws(()=>wrong.getDemonstration(t.data.demonstration.id),/authentication-failed/); } finally { wrong.close(); }
    const tiny=await HarnessStore.open(t.root,t.key,{now:t.now,maxBytes:1});
    try { assert.throws(()=>tiny.putArtifact(Buffer.from('x')),/quota-exceeded/); } finally { tiny.close(); }
  } finally { await t.cleanup(); }
});
test('revision/run transitions use compare-and-swap; action results append once and terminal states stay terminal', async () => {
  const t=await setup();
  try {
    t.seed(); const id=t.data.revision.id;
    assert.throws(()=>t.store.transitionRevision(id,'draft','approved',0),/invalid-revision-transition/);
    t.store.transitionRevision(id,'draft','queued',0);
    assert.throws(()=>t.store.transitionRevision(id,'draft','queued',0),/stale-revision-transition/);
    t.store.transitionRevision(id,'queued','verifying',1);
    assert.throws(()=>t.store.transitionRevision(id,'verifying','approved',2),/promotion-gate-not-implemented/);
    t.store.transitionRevision(id,'verifying','blocked',2);
    assert.throws(()=>t.store.transitionRevision(id,'blocked','queued',3),/invalid-revision-transition/);
    const run=ExecutionRun.parse({schemaVersion:1,id:newId(),approvedSkillHash:t.data.revision.contentHash,inputHash:'b'.repeat(64),browserId:'synthetic',sessionId:newId(),tabId:1,
      activation:{userConfirmed:true,at:new Date(initial).toISOString()},state:'created',budgets:{remainingActions:10,remainingModelCalls:1,deadline:new Date(initial+60000).toISOString()},artifactIds:[],createdAt:new Date(initial).toISOString()});
    t.store.putRun(run);t.store.transitionRun(run.id,'created','running',0);
    assert.throws(()=>t.store.transitionRun(run.id,'created','running',0),/stale-run-transition/);
    const action={schemaVersion:1,id:newId(),runId:run.id,actionId:newId(),sequence:1,completedAt:new Date(initial).toISOString(),outcome:'succeeded',evidenceIds:[]};
    t.store.appendAction(action);
    assert.throws(()=>t.store.appendAction(action),/sequence-mismatch/);
    assert.equal(t.store.getActions(run.id).length,1);
    t.store.transitionRun(run.id,'running','paused',1);t.store.transitionRun(run.id,'paused','running',2);
    t.store.transitionRun(run.id,'running','succeeded',3);
    assert.throws(()=>t.store.transitionRun(run.id,'succeeded','running',4),/invalid-run-transition/);
    assert.throws(()=>t.store.appendAction({...action,id:newId(),actionId:newId(),sequence:2}),/run-not-running/);
  } finally { await t.cleanup(); }
});
test('migrations detect changed history and catalog triggers reject body mutation', async () => {
  const t=await setup();
  try {
    t.seed();t.store.close();
    const db=new Database(join(t.root,'catalog.sqlite'));
    assert.throws(()=>db.prepare('UPDATE records SET content_hash=? WHERE id=?').run('0'.repeat(64),t.data.revision.id),/immutable-record/);
    db.prepare('UPDATE migrations SET hash=?').run('tampered');db.close();
    await assert.rejects(HarnessStore.open(t.root,t.key),/migration-hash-mismatch/);
  } finally { await t.cleanup(); }
});
test('task contracts and frozen suites are immutable, hash-bound, and require an existing contract', async () => {
  const t=await setup();
  try {
    t.seed();
    assert.deepEqual(t.store.getTaskContract(t.data.contract.id),t.data.contract);
    assert.throws(()=>t.store.putTaskContract(t.data.contract),/immutable-record/);
    assert.throws(()=>t.store.putTaskContract({...t.data.contract,allowedEffects:['navigate']}),/hash-mismatch/);
    const suite=seal({schemaVersion:1,id:newId(),version:1,contractHash:t.data.contract.contentHash,frozenAt:new Date(initial).toISOString(),scenarioSeeds:[42],mutations:['none','wrong-week'],oracleIds:['csv-oracle-v1'],requiredAssertions:['csv-exact-rows']});
    t.store.putVerificationSuite(suite);
    assert.deepEqual(t.store.getVerificationSuite(suite.id),suite);
    assert.throws(()=>t.store.putVerificationSuite(suite),/immutable-record/);
    const {contentHash:_hash,...unhashed}=suite;
    assert.throws(()=>t.store.putVerificationSuite(seal({...unhashed,id:newId(),contractHash:'f'.repeat(64)})),/unknown-task-contract/);
    t.store.deleteEvidence(t.data.contract.id);
    assert.equal(t.store.getRevision(t.data.revision.id)?.stale,true);
    assert.throws(()=>t.store.getVerificationSuite(suite.id),/source-evidence-unavailable/);
  } finally { await t.cleanup(); }
});
test('failed unlink blocks reads/writes and deletion resumes after reopen; unregistered crash artifacts are collected', async () => {
  const t=await setup();
  const artifacts=join(t.root,'artifacts');
  try {
    t.seed();
    await chmod(artifacts,0o500);
    assert.throws(()=>t.store.deleteDemonstration(t.data.demonstration.id),/deletion-pending/);
    assert.throws(()=>t.store.readArtifact(t.data.frame.encryptionRef.artifactId),/artifact-unavailable/);
    assert.throws(()=>t.store.putArtifact(Buffer.from('must not queue more content')),/deletion-pending/);
    await chmod(artifacts,0o700);t.store.close();
    const orphan=join(artifacts,`${newId()}.enc`);
    await writeFile(orphan,Buffer.from('synthetic-orphan'),{mode:0o600});
    const recovered=await HarnessStore.open(t.root,t.key,{now:t.now});
    try {
      assert.equal(recovered.getDemonstration(t.data.demonstration.id),null);
      assert.equal(recovered.getRevision(t.data.revision.id)?.stale,true);
      assert.equal((await readdir(artifacts)).length,2); // immutable revision and contract payloads only
      recovered.deleteEvidence(t.data.revision.id);
      recovered.deleteEvidence(t.data.contract.id);
      assert.deepEqual(await readdir(artifacts),[]);
    } finally { recovered.close(); }
  } finally { await chmod(artifacts,0o700);await t.cleanup(); }
});

test('explicit unencrypted store persists readable bytes across reopen without a key and detects corrupted files', async () => {
  const root = await mkdtemp(join(tmpdir(),'harness-plaintext-'));
  let store: HarnessStore | undefined;
  try {
    store = await HarnessStore.openUnencrypted(root);
    const bytes = Buffer.from('synthetic-readable-local-content');
    const id = store.putArtifact(bytes);
    const path = join(root,'artifacts',`${id}.plain`);
    assert.equal((await readFile(path)).subarray(4).toString(),bytes.toString());
    store.close();
    await assert.rejects(HarnessStore.open(root,new EphemeralKeyProvider()),/storage-protection-mode-mismatch/);
    store = await HarnessStore.openUnencrypted(root);
    assert.deepEqual(store.readArtifact(id),bytes);
    await writeFile(path,Buffer.from('VH00corrupted'),{mode:0o600});
    assert.throws(()=>store!.readArtifact(id),/artifact-integrity-failed/);

  } finally {store?.close();await rm(root,{recursive:true,force:true});}
});
