import { newId, hashBytes, signReport, checkContentHash, type SkillRevision, type TaskContract, type VerificationSuite, type VerificationAuthority, type VerificationReport } from '../../packages/contracts/src/index.js';
import { inspectCSV, previousWeek, type Task } from './oracle.js';

// Supervisor-owned observations only. Never accept this structure from candidate IPC.
export interface ReportingObservation {
  seed: number;
  mutation: VerificationSuite['mutations'][number];
  task: Task;
  bytes?: Buffer;
  exportAudit: {team:string;start:string;end:string}[];
  effects: { origin: string; kind: 'navigate' | 'input' | 'download' }[];
  unavailable?: boolean;
}
export function evaluateReportingSuite(revision: SkillRevision, contract: TaskContract, suite: VerificationSuite, observations: ReportingObservation[], authority: VerificationAuthority): VerificationReport {
  for (const value of [revision,contract,suite]) checkContentHash(value);
  if (revision.contractHash !== contract.contentHash || suite.contractHash !== contract.contentHash) throw new Error('verification-context-mismatch');
  const expected = suite.scenarioSeeds.flatMap(seed => suite.mutations.map(mutation => `${seed}:${mutation}`));
  if (new Set(expected).size !== expected.length) throw new Error('duplicate-suite-scenario');
  const seen = new Set<string>(), evidenceHashes: string[] = [];
  let failed = false, missing = false, csvFailed = false, effectsFailed = false;
  for (const observation of observations) {
    const key = `${observation.seed}:${observation.mutation}`;
    if (!expected.includes(key) || seen.has(key)) throw new Error('unexpected-or-duplicate-scenario');
    seen.add(key);
    if (observation.effects.some(effect => !contract.allowedOrigins.includes(effect.origin) || !contract.allowedEffects.includes(effect.kind))) effectsFailed = true;
    const range=previousWeek(observation.task);
    if (observation.exportAudit.length > 1 || observation.exportAudit.some(entry=>entry.team!==observation.task.team||entry.start!==range.start||entry.end!==range.end)) effectsFailed=true;
    if (observation.task.timezone !== contract.timezone) throw new Error('scenario-timezone-mismatch');
    if (observation.unavailable || !observation.bytes) { missing = true; continue; }
    if (observation.exportAudit.length!==1 || observation.effects.filter(effect=>effect.kind==='download').length!==1) effectsFailed=true;
    if (observation.bytes.length > contract.limits.maxArtifactBytes) { csvFailed = true; continue; }
    evidenceHashes.push(hashBytes(observation.bytes));
    try { if (inspectCSV(observation.bytes, observation.task).verdict !== 'passed') csvFailed = true; }
    catch { missing = true; }
  }
  missing ||= seen.size !== expected.length;
  failed = csvFailed || effectsFailed;
  const assertions: VerificationReport['assertions'] = [
    {id:'csv-exact-rows',required:true,result:csvFailed?'failed':missing?'missing':'passed'},
    {id:'permitted-effects',required:true,result:effectsFailed?'failed':missing?'missing':'passed'},
    {id:'scenario-coverage',required:true,result:seen.size===expected.length?'passed':'missing'},
  ];
  const required = new Set([...suite.requiredAssertions,...contract.artifactAssertions,...contract.stateAssertions,...contract.semanticCriteria.filter(c=>c.required).map(c=>c.id)]);
  for (const id of required) if (!assertions.some(a=>a.id===id)) { assertions.push({id,required:true,result:'missing'}); missing=true; }
  return signReport({schemaVersion:1,id:newId(),candidateHash:revision.contentHash,contractHash:contract.contentHash,suiteHash:suite.contentHash,environmentHash:authority.environmentHash,runtimeHash:authority.runtimeHash,verdict:failed?'blocked':missing?'inconclusive':'approved',assertions,modelRequestRefs:[],evidenceHashes,failures:failed?['Independent artifact or permitted-effect assertion failed']:[],completedAt:new Date().toISOString()},authority);
}
