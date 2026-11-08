import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { evaluateReportingSuite, type ReportingObservation } from '../services/verifier/reporting.js';
import { inspectCSV, previousWeek, type Task } from '../services/verifier/oracle.js';
import { seal, newId, VerificationSuite, validateReport } from '../packages/contracts/src/index.js';
import { synthetic } from './fixtures/synthetic.js';
function fixture(){
  const data=synthetic();const task:Task={team:'red',asOf:'2026-11-07T20:00:00Z',timezone:'America/Los_Angeles'};
  const suite=VerificationSuite.parse(seal({schemaVersion:1,id:newId(),version:1,contractHash:data.contract.contentHash,frozenAt:data.revision.createdAt,scenarioSeeds:[1,2],mutations:['none'],oracleIds:['csv-v1'],requiredAssertions:['csv-exact-rows','permitted-effects','scenario-coverage']}));
  const authority={keyId:'test',key:randomBytes(32),environmentHash:'a'.repeat(64),runtimeHash:'b'.repeat(64)};
  const range=previousWeek(task);
  const observation:ReportingObservation={seed:1,mutation:'none',task,bytes:Buffer.from(inspectCSV(Buffer.from(''),task).expected),effects:[{origin:data.contract.allowedOrigins[0],kind:'download'}],exportAudit:[{team:'red',start:range.start,end:range.end}]};
  const evaluate=(observations:ReportingObservation[])=>evaluateReportingSuite(data.revision,data.contract,suite,observations,authority);
  return {data,task,suite,authority,observation,evaluate};
}
test('supervisor requires every frozen scenario, actual artifact bytes and an independent effect audit',()=>{
  const f=fixture(),a=f.observation,b={...a,seed:2};
  const good=f.evaluate([a,b]);assert.equal(good.verdict,'approved');validateReport(good,f.data.revision,f.data.contract,f.suite,f.authority);
  assert.equal(f.evaluate([a]).verdict,'inconclusive');
  assert.equal(f.evaluate([{...a,bytes:undefined,exportAudit:[],effects:[],unavailable:true}]).verdict,'inconclusive');
  assert.equal(f.evaluate([{...a,bytes:Buffer.from('Export successful')},b]).verdict,'blocked');
  assert.equal(f.evaluate([{...a,exportAudit:[...a.exportAudit,...a.exportAudit]},b]).verdict,'blocked');
  assert.equal(f.evaluate([{...a,effects:[{origin:'https://unlisted.example',kind:'download'}]},b]).verdict,'blocked');
  assert.throws(()=>f.evaluate([a,a]),/duplicate-scenario/);
});
test('supervisor cannot approve required semantic criteria without independent judgments',()=>{
  const f=fixture();const {contentHash:_hash,...body}=f.data.contract;
  const contract=seal({...body,semanticCriteria:[{id:'snap-scope',questionVersion:'v1',required:true,threshold:0.9}]});
  const {contentHash:_revision,...revision}=f.data.revision;const {contentHash:_suite,...suite}=f.suite;
  const report=evaluateReportingSuite(seal({...revision,contractHash:contract.contentHash}),contract,seal({...suite,contractHash:contract.contentHash}),[f.observation,{...f.observation,seed:2}],f.authority);
  assert.equal(report.verdict,'inconclusive');assert.ok(report.assertions.some(a=>a.id==='snap-scope'&&a.result==='missing'));
});
