import { createHmac, timingSafeEqual } from 'node:crypto';
import { VerificationReport, type TaskContract, type VerificationSuite, type SkillRevision } from './schemas.js';
import { canonicalJSON, checkContentHash } from './index.js';

export interface VerificationAuthority {
  keyId: string;
  key: Buffer;
  environmentHash: string;
  runtimeHash: string;
}
function signature(report: VerificationReport, key: Buffer) {
  if (key.length < 32) throw new Error('verification-key-too-short');
  const { authentication, ...body } = report;
  return createHmac('sha256', key).update('cobrowser-verification-v1\n').update(canonicalJSON({ ...body, authentication: { keyId: authentication.keyId, algorithm: authentication.algorithm } })).digest('hex');
}
export function signReport(input: Omit<VerificationReport, 'authentication'>, authority: VerificationAuthority): VerificationReport {
  const report = VerificationReport.parse({ ...input, authentication: { keyId: authority.keyId, algorithm: 'hmac-sha256', signature: '0'.repeat(64) } });
  report.authentication.signature = signature(report, authority.key);
  return report;
}
export function validateReport(input: unknown, revision: SkillRevision, contract: TaskContract, suite: VerificationSuite, authority: VerificationAuthority, now = Date.now()) {
  const report = VerificationReport.parse(input);
  for (const value of [revision, contract, suite]) checkContentHash(value);
  if (report.authentication.keyId !== authority.keyId || !timingSafeEqual(Buffer.from(report.authentication.signature, 'hex'), Buffer.from(signature(report, authority.key), 'hex'))) throw new Error('report-authentication-failed');
  if (report.candidateHash !== revision.contentHash || report.contractHash !== contract.contentHash || revision.contractHash !== contract.contentHash || suite.contractHash !== contract.contentHash || report.suiteHash !== suite.contentHash || report.environmentHash !== authority.environmentHash || report.runtimeHash !== authority.runtimeHash) throw new Error('report-context-mismatch');
  if (Date.parse(report.completedAt) > now || Date.parse(report.completedAt) < Math.max(Date.parse(suite.frozenAt), Date.parse(revision.createdAt))) throw new Error('report-time-invalid');
  const ids = report.assertions.map(a => a.id);
  if (new Set(ids).size !== ids.length) throw new Error('duplicate-report-assertion');
  const required = new Set([...suite.requiredAssertions, ...contract.artifactAssertions, ...contract.stateAssertions, ...contract.semanticCriteria.filter(c => c.required).map(c => c.id)]);
  if (report.verdict === 'approved') {
    if (!report.evidenceHashes.length) throw new Error('report-evidence-missing');
    for (const id of required) if (!report.assertions.some(a => a.id === id && a.required && a.result === 'passed')) throw new Error('required-assertion-missing');
    if (report.assertions.some(a => a.result !== 'passed')) throw new Error('nonpassing-assertion');
  }
  return report;
}
