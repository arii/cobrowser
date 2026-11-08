import { z } from 'zod';

export const SCHEMA_VERSION = 1 as const;
export const Id = z.uuid();
export const Hash = z.string().regex(/^[a-f0-9]{64}$/);
export const UTC = z.iso.datetime();
export const Timezone = z.string().max(100).refine(value => { try { new Intl.DateTimeFormat('en', { timeZone: value }); return value.includes('/'); } catch { return false; } }, 'Explicit IANA timezone required');
export const Origin = z.url().refine(value => { const u = new URL(value); return ['http:', 'https:'].includes(u.protocol) && u.origin === value && !u.username && !u.password; }, 'Exact HTTP(S) origin required');
const Version = z.literal(SCHEMA_VERSION);
const Label = z.string().min(1).max(200);
const IDs = z.array(Id).max(1000);
const Hashes = z.array(Hash).max(1000);
const positive = z.number().int().positive();
export const Provenance = z.enum(['human', 'agent', 'unknown']);
export const ObservationEvent = z.object({
  schemaVersion: Version, id: Id, utc: UTC, monotonicNs: z.string().regex(/^\d{1,20}$/),
  browserId: Label, connectionId: Id, windowId: z.number().int().nonnegative(), tabId: z.number().int().nonnegative(),
  documentId: Label, frameId: Label, sequence: positive, approvedOrigin: Origin,
  kind: z.enum(['navigation', 'click', 'field-commit', 'download', 'pause', 'resume']),
  target: z.object({ role: Label, label: Label, sensitive: z.literal(false) }).strict(),
  frameRef: Id.optional(), provenance: Provenance,
}).strict();
export type ObservationEvent = z.infer<typeof ObservationEvent>;
const Rectangle = z.object({ x: z.number().nonnegative(), y: z.number().nonnegative(), width: positive, height: positive }).strict();
export const VisualFrame = z.object({
  schemaVersion: Version, id: Id, captureSource: z.enum(['screencapturekit', 'chrome-cdp', 'synthetic']),
  utc: UTC, monotonicNs: z.string().regex(/^\d{1,20}$/), width: positive, height: positive,
  scale: z.number().positive().max(8), bindingId: Id, crop: Rectangle,
  masks: z.array(Rectangle).max(100), privacyPolicyVersion: Label,
  encryptionRef: z.object({ artifactId: Id, keyId: Label, algorithm: z.literal('aes-256-gcm') }).strict(),
  contentHash: Hash,
}).strict().refine(f => f.crop.x + f.crop.width <= f.width && f.crop.y + f.crop.height <= f.height, 'Crop exceeds frame');
export type VisualFrame = z.infer<typeof VisualFrame>;
export const Demonstration = z.object({
  schemaVersion: Version, id: Id, taskFamily: Label, createdAt: UTC,
  eventIds: IDs.min(1), frameIds: IDs, artifactIds: IDs,
  inputs: z.record(z.string(), z.json()),
  outcome: z.object({ independentlyObserved: z.literal(true), kind: z.enum(['download', 'controlled-stop']), evidenceIds: IDs.min(1) }).strict(),
  humanCorrections: z.array(z.string().max(1000)).max(100), assignment: z.enum(['train', 'held-out']),
  provenance: z.literal('human'),
}).strict();
export type Demonstration = z.infer<typeof Demonstration>;
export const TaskContract = z.object({
  schemaVersion: Version, id: Id, version: positive, contentHash: Hash,
  inputSchema: z.record(z.string(), z.json()),
  timezone: Timezone, previousWeek: z.literal('monday-to-monday-end-exclusive'),
  allowedOrigins: z.array(Origin).min(1).max(10), allowedEffects: z.array(z.enum(['navigate', 'input', 'download'])).max(3),
  artifactAssertions: z.array(Label).min(1).max(100), stateAssertions: z.array(Label).max(100),
  semanticCriteria: z.array(z.object({ id: Label, questionVersion: Label, required: z.boolean(), threshold: z.number().min(0).max(1) }).strict()).max(100),
  controlledStopRules: z.array(Label).min(1).max(100),
  limits: z.object({ maxActions: positive.max(1000), maxDurationMs: positive.max(3600000), maxModelCalls: z.number().int().nonnegative().max(100), maxArtifactBytes: positive.max(100000000) }).strict(),
}).strict();
export type TaskContract = z.infer<typeof TaskContract>;
const Parameter = z.string().regex(/^[a-zA-Z][a-zA-Z0-9_]{0,63}$/);
export const Step = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('observe') }).strict(),
  z.object({ kind: z.literal('click'), target: Label }).strict(),
  z.object({ kind: z.literal('type'), target: Label, parameter: Parameter }).strict(),
  z.object({ kind: z.literal('scroll'), deltaY: z.number().int().min(-2000).max(2000) }).strict(),
  z.object({ kind: z.literal('wait'), durationMs: positive.max(10000) }).strict(),
  z.object({ kind: z.literal('download'), target: Label }).strict(),
  z.object({ kind: z.literal('stop'), reason: Label }).strict(),
]);
export const SkillRevision = z.object({
  schemaVersion: Version, id: Id, skillId: Id, parentHash: Hash.nullable(), contentHash: Hash,
  contractHash: Hash, createdAt: UTC, parameterSchema: z.record(z.string(), z.json()),
  procedure: z.array(Step).min(1).max(100),
  requestedCapabilities: z.array(z.enum(['observe-approved-tab', 'input-assigned-tab', 'download-approved-artifact'])).max(3),
  demonstrationIds: IDs, reviewedImport: z.object({ bindingHash: Hash, reviewedAt: UTC }).strict().optional(), generator: z.object({ provider: z.literal('meta-llama'), model: Label, promptVersion: Label, mode: z.enum(['live', 'replay']) }).strict(),
}).strict().refine(value => value.demonstrationIds.length > 0 || value.reviewedImport !== undefined, 'A training demonstration or explicit reviewed import is required');
export type SkillRevision = z.infer<typeof SkillRevision>;
export const RevisionState = z.enum(['draft', 'queued', 'verifying', 'approved', 'blocked', 'inconclusive']);
export type RevisionState = z.infer<typeof RevisionState>;
export const RunState = z.enum(['created', 'running', 'paused', 'needs_user', 'succeeded', 'failed', 'cancelled']);
export type RunState = z.infer<typeof RunState>;
export const ActionArguments = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('click'), x: z.number().nonnegative(), y: z.number().nonnegative() }).strict(),
  z.object({ kind: z.literal('type'), text: z.string().min(1).max(1000) }).strict(),
  z.object({ kind: z.literal('key'), key: z.enum(['Tab', 'Enter', 'Escape', 'ArrowDown', 'ArrowUp', 'Backspace']) }).strict(),
  z.object({ kind: z.literal('scroll'), deltaX: z.number().int().min(-2000).max(2000), deltaY: z.number().int().min(-2000).max(2000) }).strict(),
]);
export const ActionRequest = z.object({
  schemaVersion: Version, id: Id, runId: Id, sessionId: Id, tabId: positive, windowId: z.number().int().nonnegative(),
  documentId: Label, origin: Origin, observationSequence: positive, createdAt: UTC, expiresAt: UTC,
  action: ActionArguments,
}).strict().refine(a => Date.parse(a.expiresAt) > Date.parse(a.createdAt) && Date.parse(a.expiresAt) - Date.parse(a.createdAt) <= 30000, 'Action validity window must be 1–30000 ms');
export type ActionRequest = z.infer<typeof ActionRequest>;
export const VerificationSuite = z.object({
  schemaVersion: Version, id: Id, version: positive, contentHash: Hash, contractHash: Hash, frozenAt: UTC,
  scenarioSeeds: z.array(z.number().int().nonnegative()).min(1).max(1000),
  mutations: z.array(z.enum(['none', 'wrong-week', 'wrong-team', 'expired-session', 'prompt-injection', 'slow-loading'])).min(1).max(100),
  oracleIds: z.array(Label).min(1).max(100), requiredAssertions: z.array(Label).min(1).max(100),
}).strict();
export type VerificationSuite = z.infer<typeof VerificationSuite>;
export const VerificationReport = z.object({
  schemaVersion: Version, id: Id, candidateHash: Hash, contractHash: Hash, suiteHash: Hash, environmentHash: Hash, runtimeHash: Hash,
  verdict: z.enum(['approved', 'blocked', 'inconclusive']),
  assertions: z.array(z.object({ id: Label, required: z.boolean(), result: z.enum(['passed', 'failed', 'missing']) }).strict()).min(1).max(1000),
  modelRequestRefs: IDs, evidenceHashes: Hashes, failures: z.array(Label).max(1000), completedAt: UTC,
  authentication: z.object({ keyId: Label, algorithm: z.literal('hmac-sha256'), signature: Hash }).strict(),
}).strict().refine(r => r.verdict !== 'approved' || (r.failures.length === 0 && r.assertions.every(a => !a.required || a.result === 'passed')), 'Failed/missing required assertions cannot approve');
export type VerificationReport = z.infer<typeof VerificationReport>;
export const ExecutionRun = z.object({
  schemaVersion: Version, id: Id, approvedSkillHash: Hash, inputHash: Hash, browserId: Label, sessionId: Id, tabId: positive,
  activation: z.object({ userConfirmed: z.literal(true), at: UTC }).strict(), state: RunState,
  budgets: z.object({ remainingActions: z.number().int().nonnegative(), remainingModelCalls: z.number().int().nonnegative(), deadline: UTC }).strict(),
  artifactIds: IDs, createdAt: UTC,
}).strict();
export type ExecutionRun = z.infer<typeof ExecutionRun>;
export const ActionResult = z.object({ schemaVersion: Version, id: Id, runId: Id, actionId: Id, sequence: positive, completedAt: UTC, outcome: z.enum(['succeeded', 'failed', 'controlled-stop']), evidenceIds: IDs }).strict();
export type ActionResult = z.infer<typeof ActionResult>;

