import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { HarnessStore, EphemeralKeyProvider } from '../packages/storage/src/index.js';
import { synthetic } from '../tests/fixtures/synthetic.js';

const root=await mkdtemp(join(tmpdir(),'harness-foundation-'));
const provider=new EphemeralKeyProvider();
let now=Date.parse('2026-11-07T20:00:00.000Z');
const data=synthetic();
let store=await HarnessStore.open(root,provider,{now:()=>now});
try {
  store.putTaskContract(data.contract);store.putFrame(data.frame,data.bytes);store.putEvent(data.event);store.putDemonstration(data.demonstration);store.putRevision(data.revision);
  assert.deepEqual(store.getDemonstration(data.demonstration.id),data.demonstration);
  assert.throws(()=>store.putRevision(data.revision),/immutable/);
  assert.throws(()=>store.transitionRevision(data.revision.id,'draft','approved',0),/invalid-revision-transition/);
  const before=store.stats();store.close();
  store=await HarnessStore.open(root,provider,{now:()=>now});
  assert.deepEqual(store.getDemonstration(data.demonstration.id),data.demonstration);
  now+=86400001;store.expire();
  assert.equal(store.getEvent(data.event.id),null);
  assert.equal(store.getFrame(data.frame.id),null);
  assert.equal(store.getRevision(data.revision.id)?.stale,true);
  store.deleteDemonstration(data.demonstration.id);
  assert.equal(store.getDemonstration(data.demonstration.id),null);
  store.deleteEvidence(data.revision.id);
  store.deleteEvidence(data.contract.id);
  assert.deepEqual(store.stats(),{records:0,artifacts:0,bytes:0});
  assert.deepEqual(await readdir(join(root,'artifacts')),[]);
  const report={schemaVersion:1,mode:'live-local-synthetic-storage',keyProvider:'ephemeral-test-key-not-Keychain',
    sqlite:'better-sqlite3-13.0.3',before,after:store.stats(),checks:{store:true,retrieve:true,reopen:true,expire:true,delete:true,immutableRevision:true,invalidTransitionRejected:true,derivedRevisionStale:true},
    note:'No model call, browser execution or promotion. Ephemeral key and temporary store removed after this check.'};
  await mkdir('.local/evidence',{recursive:true});await writeFile('.local/evidence/foundation.json',JSON.stringify(report,null,2));
  console.log(JSON.stringify(report,null,2));
} finally { store.close();await rm(root,{recursive:true,force:true}); }
