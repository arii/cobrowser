import Database from 'better-sqlite3';
import { mkdirSync, lstatSync, existsSync, writeFileSync, readFileSync, unlinkSync, readdirSync, openSync, closeSync } from 'node:fs';
import { join } from 'node:path';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { migrations } from './migrations.js';
import { ActionResult, Demonstration, ExecutionRun, ObservationEvent, SkillRevision, VisualFrame, TaskContract, VerificationSuite, Id, canonicalJSON, checkContentHash, contentHash, hashBytes, newId, assertRevisionTransition, assertRunTransition, type RevisionState, type RunState, validateReport, type VerificationAuthority } from '../../contracts/src/index.js';

export interface KeyProvider { getKey(): Promise<Buffer> }
export class EphemeralKeyProvider implements KeyProvider {
  // Synthetic tests/CLI only. Never a production persistence fallback.
  constructor(private readonly key = randomBytes(32)) {}
  async getKey() { return Buffer.from(this.key); }
}
type Row = { id: string; kind: string; payload_id: string; content_hash: string; expires_at: number | null; stale: number };
type Artifact = { id: string; content_hash: string; bytes: number; expires_at: number; pending_delete: number };
const DAY = 86400000;
const schemas = { event: ObservationEvent, frame: VisualFrame, demonstration: Demonstration, revision: SkillRevision, run: ExecutionRun, contract: TaskContract, suite: VerificationSuite };
export class HarnessStore {
  private readonly db!: Database.Database;
  private readonly key: Buffer;
  private closed = false;
  private readonly lockPath: string;
  private readonly artifactDir: string;
  private constructor(private readonly root: string, key: Buffer, private readonly now: () => number, private readonly quota: number, private readonly rawRetentionMs: number, private readonly demonstrationRetentionMs: number, private readonly unencrypted = false) {
    if (![quota,rawRetentionMs,demonstrationRetentionMs].every(value=>Number.isSafeInteger(value)&&value>0) || rawRetentionMs>DAY || demonstrationRetentionMs>30*DAY) throw new Error('invalid-storage-limits');
    this.key = Buffer.from(key);
    if (this.key.length !== 32) throw new Error('invalid-artifact-key');
    this.privateDirectory(root);
    this.artifactDir = join(root, 'artifacts'); this.privateDirectory(this.artifactDir);
    this.lockPath = join(root, 'writer.lock');
    this.acquireLock();
    try {
      const marker = join(root, 'unencrypted-mode');
      if (this.unencrypted) {
        if (!existsSync(marker)) {
          if (existsSync(join(root, 'catalog.sqlite'))) throw new Error('storage-protection-mode-mismatch');
          writeFileSync(marker, 'unencrypted-v1\n', {mode:0o600,flag:'wx'});
        }
        this.privateFile(marker);
        if (readFileSync(marker, 'utf8') !== 'unencrypted-v1\n') throw new Error('storage-protection-mode-mismatch');
      } else if (existsSync(marker)) throw new Error('storage-protection-mode-mismatch');
      const path = join(root, 'catalog.sqlite');
      if (!existsSync(path)) closeSync(openSync(path, 'wx', 0o600));
      this.privateFile(path);
      this.db = new Database(path);
      this.db.pragma('foreign_keys = ON'); this.db.pragma('journal_mode = WAL'); this.db.pragma('secure_delete = ON');
      this.db.exec('CREATE TABLE IF NOT EXISTS migrations(version INTEGER PRIMARY KEY, hash TEXT NOT NULL)');
      for (const migration of migrations) {
        const old = this.db.prepare('SELECT hash FROM migrations WHERE version=?').get(migration.version) as { hash: string } | undefined;
        const hash = hashBytes(Buffer.from(migration.sql));
        if (old && old.hash !== hash) throw new Error('migration-hash-mismatch');
        if (!old) this.db.transaction(() => { this.db.exec(migration.sql); this.db.prepare('INSERT INTO migrations VALUES(?,?)').run(migration.version, hash); })();
      }
      const newest = this.db.prepare('SELECT MAX(version) AS version FROM migrations').get() as { version: number };
      if (newest.version !== migrations.at(-1)!.version) throw new Error('unsupported-storage-version');
      this.recover(); this.expire();
    } catch (error) { this.db?.close(); unlinkSync(this.lockPath); this.key.fill(0); throw error; }
  }
  static async open(root: string, provider: KeyProvider, options: { now?: () => number; maxBytes?: number; rawRetentionMs?: number; demonstrationRetentionMs?: number } = {}) {
    const key = await provider.getKey();
    try { return new HarnessStore(root, key, options.now ?? Date.now, options.maxBytes ?? 64 * 1024 * 1024, options.rawRetentionMs ?? DAY, options.demonstrationRetentionMs ?? 7*DAY); }
    finally { key.fill(0); }
  }
  // Explicit local mode: contents are readable on disk; no Keychain or secret key.
  static async openUnencrypted(root: string, options: { now?: () => number; maxBytes?: number; rawRetentionMs?: number; demonstrationRetentionMs?: number } = {}) {
    return new HarnessStore(root, Buffer.alloc(32), options.now ?? Date.now, options.maxBytes ?? 64 * 1024 * 1024, options.rawRetentionMs ?? DAY, options.demonstrationRetentionMs ?? 7*DAY, true);
  }
  private privateDirectory(path: string) {
    mkdirSync(path, { recursive: true, mode: 0o700 });
    const st = lstatSync(path);
    if (!st.isDirectory() || st.isSymbolicLink() || st.uid !== process.getuid?.() || (st.mode & 0o077)) throw new Error('storage-directory-must-be-user-only');
  }
  private privateFile(path: string) {
    const st = lstatSync(path);
    if (!st.isFile() || st.isSymbolicLink() || st.uid !== process.getuid?.() || (st.mode & 0o077)) throw new Error('storage-file-must-be-user-only');
  }
  private acquireLock() {
    if (existsSync(this.lockPath)) {
      this.privateFile(this.lockPath);
      const pid = Number(readFileSync(this.lockPath, 'utf8'));
      if (!Number.isSafeInteger(pid) || pid <= 0) throw new Error('invalid-storage-lock');
      try { process.kill(pid, 0); throw new Error('storage-already-open'); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error; }
      unlinkSync(this.lockPath);
    }
    writeFileSync(this.lockPath, String(process.pid), { mode: 0o600, flag: 'wx' });
  }
  private path(id: string) { return join(this.artifactDir, `${Id.parse(id)}.${this.unencrypted ? 'plain' : 'enc'}`); }
  private ensureOpen() { if (this.closed) throw new Error('storage-closed'); }
  private createArtifact(bytes: Buffer, expiresAt: number, id = newId()): string {
    this.ensureOpen();
    this.flushDeletes();
    if (bytes.length > 16 * 1024 * 1024 || expiresAt <= this.now()) throw new Error('invalid-artifact-size-or-retention');
    const size = bytes.length + 32;
    const used = (this.db.prepare('SELECT COALESCE(SUM(bytes),0) AS used FROM artifacts WHERE pending_delete=0').get() as { used: number }).used;
    if (used + size > this.quota) throw new Error('storage-quota-exceeded');
    const hash = hashBytes(bytes);
    let envelope: Buffer;
    if (this.unencrypted) envelope = Buffer.concat([Buffer.from('VH00'),bytes]);
    else {
      const iv = randomBytes(12);
      const cipher = createCipheriv('aes-256-gcm', this.key, iv);
      cipher.setAAD(Buffer.from(`visual-harness:1:${id}:${hash}`));
      const ciphertext = Buffer.concat([cipher.update(bytes), cipher.final()]);
      envelope = Buffer.concat([Buffer.from('VH01'), iv, cipher.getAuthTag(), ciphertext]);
    }
    writeFileSync(this.path(id), envelope, { mode: 0o600, flag: 'wx' });
    try { this.db.prepare('INSERT INTO artifacts(id,content_hash,bytes,expires_at) VALUES(?,?,?,?)').run(id, hash, envelope.length, expiresAt); }
    catch (error) { unlinkSync(this.path(id)); throw error; }
    return id;
  }
  putArtifact(bytes: Buffer, ttlMs = this.rawRetentionMs): string {
    if (!Number.isSafeInteger(ttlMs) || ttlMs <= 0 || ttlMs > this.rawRetentionMs) throw new Error('raw-retention-limit');
    return this.createArtifact(bytes, this.now() + ttlMs);
  }
  readArtifact(id: string): Buffer {
    this.ensureOpen();
    const row = this.db.prepare('SELECT * FROM artifacts WHERE id=?').get(Id.parse(id)) as Artifact | undefined;
    if (!row || row.pending_delete || row.expires_at <= this.now()) throw new Error('artifact-unavailable');
    this.privateFile(this.path(id));
    const envelope = readFileSync(this.path(id));
    if (this.unencrypted) {
      const bytes = envelope.subarray(4);
      if (envelope.subarray(0,4).toString() !== 'VH00' || hashBytes(bytes) !== row.content_hash) throw new Error('artifact-integrity-failed');
      return bytes;
    }
    if (envelope.length < 32 || envelope.subarray(0,4).toString() !== 'VH01') throw new Error('artifact-authentication-failed');
    try {
      const decipher = createDecipheriv('aes-256-gcm', this.key, envelope.subarray(4,16));
      decipher.setAAD(Buffer.from(`visual-harness:1:${id}:${row.content_hash}`)); decipher.setAuthTag(envelope.subarray(16,32));
      const bytes = Buffer.concat([decipher.update(envelope.subarray(32)), decipher.final()]);
      if (hashBytes(bytes) !== row.content_hash) throw new Error();
      return bytes;
    } catch { throw new Error('artifact-authentication-failed'); }
  }
  private save(kind: keyof typeof schemas, input: unknown, expiresAt: number | null, sources: string[] = [], artifacts: string[] = []) {
    const value = schemas[kind].parse(input);
    const createdAt = 'createdAt' in value ? Date.parse(value.createdAt) : 'utc' in value ? Date.parse(value.utc) : 'frozenAt' in value ? Date.parse(value.frozenAt) : this.now();
    if (createdAt > this.now() || (expiresAt !== null && expiresAt <= this.now())) throw new Error('invalid-record-time');
    if (this.db.prepare('SELECT id FROM records WHERE id=?').get(value.id)) throw new Error('immutable-record');
    for (const source of sources) {
      const record = this.db.prepare('SELECT * FROM records WHERE id=?').get(source) as Row | undefined;
      if (!record || record.stale || (record.expires_at !== null && record.expires_at <= this.now())) throw new Error('source-evidence-unavailable');
    }
    for (const artifact of artifacts) this.readArtifact(artifact);
    const payload = this.createArtifact(Buffer.from(canonicalJSON(value)), expiresAt ?? 8640000000000000);
    try {
      this.db.transaction(() => {
        this.db.prepare('INSERT INTO records(id,kind,payload_id,content_hash,created_at,expires_at) VALUES(?,?,?,?,?,?)').run(value.id,kind,payload,contentHash(value),createdAt,expiresAt);
        for (const id of new Set([payload, ...artifacts])) this.db.prepare('INSERT INTO record_artifacts VALUES(?,?)').run(value.id,id);
        for (const id of new Set(sources)) this.db.prepare('INSERT INTO dependencies VALUES(?,?)').run(value.id,id);
      })();
    } catch (error) { this.db.prepare('UPDATE artifacts SET pending_delete=1 WHERE id=?').run(payload); this.flushDeletes(); throw error; }
    return value;
  }
  putEvent(input: unknown) {
    const value = ObservationEvent.parse(input);
    if (value.approvedOrigin !== 'http://127.0.0.1:3210') throw new Error('observation-origin-not-allowlisted');
    return this.save('event', value, Date.parse(value.utc) + this.rawRetentionMs, value.frameRef ? [value.frameRef] : []) as ObservationEvent;
  }
  putFrame(input: unknown, bytes: Buffer) {
    const value = VisualFrame.parse(input);
    if (value.contentHash !== hashBytes(bytes) || value.encryptionRef.keyId !== 'artifact-key-v1') throw new Error('frame-artifact-binding-mismatch');
    const expiresAt = Date.parse(value.utc) + this.rawRetentionMs;
    const artifact = this.createArtifact(bytes, expiresAt, value.encryptionRef.artifactId);
    try { return this.save('frame', value, expiresAt, [], [artifact]) as VisualFrame; }
    catch (error) { this.db.prepare('UPDATE artifacts SET pending_delete=1 WHERE id=?').run(artifact); this.flushDeletes(); throw error; }
  }
  putDemonstration(input: unknown) {
    const value = Demonstration.parse(input);
    for (const id of value.eventIds) if (this.getEvent(id)?.provenance !== 'human') throw new Error('human-demonstration-requires-human-events');
    const sources = [...value.eventIds, ...value.frameIds];
    if (value.outcome.evidenceIds.some(id => ![...sources, ...value.artifactIds].includes(id))) throw new Error('unbound-outcome-evidence');
    for (const id of value.frameIds) if (!this.getFrame(id)) throw new Error('frame-evidence-unavailable');
    return this.save('demonstration', value, Date.parse(value.createdAt) + this.demonstrationRetentionMs, sources, value.artifactIds) as Demonstration;
  }
  putRevision(input: unknown) {
    const value = SkillRevision.parse(input); checkContentHash(value);
    if (value.reviewedImport && (Date.parse(value.reviewedImport.reviewedAt) > this.now() || !value.parameterSchema.$extensionWorkflow || contentHash(value.parameterSchema.$extensionWorkflow) !== value.reviewedImport.bindingHash)) throw new Error('reviewed-import-binding-mismatch');
    const contract = this.findHashed('contract',value.contractHash) as TaskContract | null;
    if (!contract) throw new Error('unknown-task-contract');
    if ((value.requestedCapabilities.includes('input-assigned-tab') && !contract.allowedEffects.includes('input'))
      || (value.requestedCapabilities.includes('download-approved-artifact') && !contract.allowedEffects.includes('download'))) throw new Error('revision-capability-outside-contract');
    for (const id of value.demonstrationIds) {
      const demo = this.getDemonstration(id);
      if (!demo || demo.assignment !== 'train') throw new Error('revision-requires-training-demonstration');
    }
    if (value.parentHash) {
      const parent = this.db.prepare('SELECT id,skill_id FROM revisions WHERE content_hash=?').get(value.parentHash) as { id: string; skill_id: string } | undefined;
      if (!parent || parent.skill_id !== value.skillId) throw new Error('invalid-revision-parent');
    }
    if (this.db.prepare('SELECT id FROM revisions WHERE content_hash=?').get(value.contentHash)) throw new Error('immutable-revision');
    // Same transaction for immutable record and initial state; orphan encrypted files
    // from a process crash are reclaimed by recover() on the next exclusive open.
    this.db.transaction(() => { this.save('revision',value,null,[...value.demonstrationIds,contract.id]); this.db.prepare('INSERT INTO revisions(id,skill_id,content_hash,state) VALUES(?,?,?,?)').run(value.id,value.skillId,value.contentHash,'draft'); })();
    return value;
  }
  private findHashed(kind: 'contract' | 'suite', hash: string) {
    const row=this.db.prepare('SELECT record_id FROM hash_bindings WHERE hash=?').get(hash) as {record_id:string}|undefined;
    return row ? this.get(kind,row.record_id) : null;
  }
  putTaskContract(input: unknown) {
    const value=TaskContract.parse(input);checkContentHash(value);
    this.db.transaction(()=>{this.save('contract',value,null);this.db.prepare('INSERT INTO hash_bindings VALUES(?,?)').run(value.contentHash,value.id);})();
    return value;
  }
  getTaskContract(id: string) { return this.get('contract',id) as TaskContract|null; }
  putVerificationSuite(input: unknown) {
    const value=VerificationSuite.parse(input);checkContentHash(value);
    const contract=this.findHashed('contract',value.contractHash);
    if (!contract) throw new Error('unknown-task-contract');
    this.db.transaction(()=>{this.save('suite',value,null,[contract.id]);this.db.prepare('INSERT INTO hash_bindings VALUES(?,?)').run(value.contentHash,value.id);})();
    return value;
  }
  getVerificationSuite(id: string) { return this.get('suite',id) as VerificationSuite|null; }
  private get(kind: keyof typeof schemas, id: string) {
    this.ensureOpen();
    const row = this.db.prepare('SELECT * FROM records WHERE id=? AND kind=?').get(Id.parse(id),kind) as Row | undefined;
    if (!row || (row.expires_at !== null && row.expires_at <= this.now())) return null;
    const invalidSource = this.db.prepare(`WITH RECURSIVE sources(id) AS (
      SELECT ? UNION SELECT d.source_id FROM dependencies d JOIN sources s ON d.owner_id=s.id
    ) SELECT r.id FROM sources s JOIN records r ON r.id=s.id
      WHERE r.stale=1 OR r.expires_at<=? OR EXISTS (
        SELECT 1 FROM record_artifacts ra JOIN artifacts a ON a.id=ra.artifact_id
        WHERE ra.record_id=r.id AND (a.pending_delete=1 OR a.expires_at<=?)
      ) LIMIT 1`).get(id,this.now(),this.now());
    if (invalidSource) { this.stale(id); row.stale = 1; }
    if (row.stale && kind !== 'revision') throw new Error('source-evidence-unavailable');
    const value = schemas[kind].parse(JSON.parse(this.readArtifact(row.payload_id).toString()));
    if (contentHash(value) !== row.content_hash) throw new Error('record-hash-mismatch');
    return value;
  }
  getEvent(id: string) { return this.get('event', id) as ObservationEvent | null; }
  getFrame(id: string) { return this.get('frame', id) as VisualFrame | null; }
  getDemonstration(id: string) { return this.get('demonstration', id) as Demonstration | null; }
  getRevision(id: string) {
    const revision = this.get('revision',id) as SkillRevision | null;
    if (!revision) return null;
    const state = this.db.prepare('SELECT r.state,r.generation,e.stale FROM revisions r JOIN records e ON e.id=r.id WHERE r.id=?').get(id) as { state: RevisionState; generation: number; stale: number };
    return { revision, ...state, stale: !!state.stale };
  }
  transitionRevision(id: string, expected: RevisionState, next: RevisionState, generation: number) {
    const record = this.getRevision(id); if (!record || record.stale) throw new Error('revision-unavailable');
    assertRevisionTransition(expected,next);
    if (next === 'approved') throw new Error('authenticated-promotion-gate-not-implemented');
    const result = this.db.prepare('UPDATE revisions SET state=?,generation=generation+1 WHERE id=? AND state=? AND generation=?').run(next,id,expected,generation);
    if (result.changes !== 1) throw new Error('stale-revision-transition');
  }
  private verificationContext(revisionId: string, suiteId: string) {
    const record = this.getRevision(revisionId), suite = this.getVerificationSuite(suiteId);
    if (!record || record.stale || !suite) throw new Error('verification-context-unavailable');
    const contract = this.findHashed('contract', record.revision.contractHash) as TaskContract | null;
    if (!contract) throw new Error('verification-context-unavailable');
    return { record, suite, contract };
  }
  getActiveSkill(skillId: string) {
    this.ensureOpen(); Id.parse(skillId);
    const pointer = this.db.prepare('SELECT revision_id,generation FROM active_skills WHERE skill_id=?').get(skillId) as {revision_id: string | null; generation: number} | undefined;
    if (!pointer?.revision_id) return { revision: null, generation: pointer?.generation ?? 0 };
    const record = this.getRevision(pointer.revision_id);
    if (!record || record.stale || record.state !== 'approved' || this.db.prepare('SELECT revision_id FROM quarantined_revisions WHERE revision_id=?').get(pointer.revision_id)) return { revision: null, generation: pointer.generation };
    return { revision: record.revision, generation: pointer.generation };
  }
  authorizeActiveSkill(skillId: string, suiteId: string, authority: VerificationAuthority) {
    const active = this.getActiveSkill(skillId);
    if (!active.revision) throw new Error('no-approved-active-revision');
    const { record, suite, contract } = this.verificationContext(active.revision.id, suiteId);
    const row = this.db.prepare("SELECT report_json FROM verification_reports WHERE revision_id=? AND verdict='approved' ORDER BY rowid DESC LIMIT 1").get(record.revision.id) as {report_json:string}|undefined;
    if (!row) throw new Error('active-approval-missing');
    validateReport(JSON.parse(row.report_json), record.revision, contract, suite, authority, this.now());
    return { ...active, contract };
  }
  // The supervisor supplies its secret authority; never expose this method through learner IPC.
  applyVerification(input: unknown, options: { revisionId: string; suiteId: string; revisionGeneration: number; activeGeneration: number; userConfirmed: boolean }, authority: VerificationAuthority) {
    this.ensureOpen();
    return this.db.transaction(() => {
      const { record, suite, contract } = this.verificationContext(options.revisionId, options.suiteId);
      const report = validateReport(input, record.revision, contract, suite, authority, this.now());
      if (record.state !== 'verifying' || record.generation !== options.revisionGeneration) throw new Error('stale-revision-transition');
      const skillId = record.revision.skillId;
      const pointer = this.db.prepare('SELECT revision_id,generation FROM active_skills WHERE skill_id=?').get(skillId) as {revision_id:string|null;generation:number}|undefined;
      if ((pointer?.generation ?? 0) !== options.activeGeneration) throw new Error('stale-active-pointer');
      if (report.verdict === 'approved' && !options.userConfirmed) throw new Error('activation-requires-user-review');
      this.db.prepare('INSERT INTO verification_reports VALUES(?,?,?,?)').run(report.id, record.revision.id, canonicalJSON(report), report.verdict);
      this.db.prepare('UPDATE revisions SET state=?,generation=generation+1 WHERE id=?').run(report.verdict, record.revision.id);
      if (report.verdict === 'approved') this.db.prepare(`INSERT INTO active_skills VALUES(?,?,1) ON CONFLICT(skill_id) DO UPDATE SET revision_id=excluded.revision_id,generation=active_skills.generation+1`).run(skillId, record.revision.id);
      this.db.prepare('INSERT INTO registry_audit(skill_id,revision_id,previous_revision_id,report_id,operation,created_at) VALUES(?,?,?,?,?,?)').run(skillId, record.revision.id, pointer?.revision_id ?? null, report.id, report.verdict, this.now());
      return { verdict: report.verdict, ...this.getActiveSkill(skillId) };
    })();
  }
  quarantineAndRollback(input: unknown, options: { revisionId: string; suiteId: string; activeGeneration: number }, authority: VerificationAuthority) {
    this.ensureOpen();
    return this.db.transaction(() => {
      const { record, suite, contract } = this.verificationContext(options.revisionId, options.suiteId);
      const report = validateReport(input, record.revision, contract, suite, authority, this.now());
      if (report.verdict !== 'blocked' || !report.assertions.some(a => a.result === 'failed')) throw new Error('rollback-requires-failed-assertion');
      const skillId = record.revision.skillId;
      const active = this.getActiveSkill(skillId);
      if (record.state !== 'approved' || active.revision?.id !== record.revision.id || active.generation !== options.activeGeneration) throw new Error('stale-active-pointer');
      this.db.prepare('INSERT INTO verification_reports VALUES(?,?,?,?)').run(report.id, record.revision.id, canonicalJSON(report), report.verdict);
      this.db.prepare('INSERT INTO quarantined_revisions VALUES(?,?)').run(record.revision.id, report.id);
      const previous = this.db.prepare("SELECT previous_revision_id FROM registry_audit WHERE revision_id=? AND operation='approved' ORDER BY sequence DESC LIMIT 1").get(record.revision.id) as {previous_revision_id:string|null}|undefined;
      let fallback: SkillRevision | null = null;
      if (previous?.previous_revision_id) {
        const prior = this.getRevision(previous.previous_revision_id);
        const approval = this.db.prepare("SELECT report_json FROM verification_reports WHERE revision_id=? AND verdict='approved' ORDER BY rowid DESC LIMIT 1").get(previous.previous_revision_id) as {report_json:string}|undefined;
        const quarantined = this.db.prepare('SELECT revision_id FROM quarantined_revisions WHERE revision_id=?').get(previous.previous_revision_id);
        if (prior && !prior.stale && prior.state === 'approved' && !quarantined && approval && prior.revision.contractHash === contract.contentHash && prior.revision.skillId === skillId && prior.revision.requestedCapabilities.every(c => record.revision.requestedCapabilities.includes(c))) {
          try { validateReport(JSON.parse(approval.report_json), prior.revision, contract, suite, authority, this.now()); fallback = prior.revision; } catch { /* incompatible approval disables execution */ }
        }
      }
      this.db.prepare('UPDATE active_skills SET revision_id=?,generation=generation+1 WHERE skill_id=?').run(fallback?.id ?? null, skillId);
      this.db.prepare('INSERT INTO registry_audit(skill_id,revision_id,previous_revision_id,report_id,operation,created_at) VALUES(?,?,?,?,?,?)').run(skillId, record.revision.id, fallback?.id ?? null, report.id, fallback ? 'rollback' : 'disabled', this.now());
      return this.getActiveSkill(skillId);
    })();
  }
  getRegistryAudit(skillId: string) {
    this.ensureOpen();
    return this.db.prepare('SELECT * FROM registry_audit WHERE skill_id=? ORDER BY sequence').all(Id.parse(skillId));
  }
  putRun(input: unknown) {
    const value = ExecutionRun.parse(input);
    if (value.state !== 'created' || value.artifactIds.length) throw new Error('run-must-start-created-without-results');
    this.db.transaction(() => { this.save('run',value,null); this.db.prepare('INSERT INTO runs(id,state) VALUES(?,?)').run(value.id,'created'); })();
    return value;
  }
  getRun(id: string) {
    const run = this.get('run',id) as ExecutionRun | null;
    if (!run) return null;
    const state = this.db.prepare('SELECT state,generation FROM runs WHERE id=?').get(id) as { state: RunState; generation: number };
    return { ...run, ...state };
  }
  transitionRun(id: string, expected: RunState, next: RunState, generation: number) {
    if (!this.getRun(id)) throw new Error('run-unavailable');
    assertRunTransition(expected,next);
    if (this.db.prepare('UPDATE runs SET state=?,generation=generation+1 WHERE id=? AND state=? AND generation=?').run(next,id,expected,generation).changes !== 1) throw new Error('stale-run-transition');
  }
  appendAction(input: unknown) {
    const value = ActionResult.parse(input), run = this.getRun(value.runId);
    if (!run || run.state !== 'running') throw new Error('run-not-running');
    const last = this.db.prepare('SELECT COALESCE(MAX(sequence),0) AS seq FROM action_results WHERE run_id=?').get(value.runId) as { seq: number };
    if (value.sequence !== last.seq + 1) throw new Error('action-sequence-mismatch');
    for (const id of value.evidenceIds) this.readArtifact(id);
    const payload = this.createArtifact(Buffer.from(canonicalJSON(value)), this.now() + this.rawRetentionMs);
    try { this.db.transaction(() => {
      this.db.prepare('INSERT INTO action_results VALUES(?,?,?,?,?)').run(value.id,value.runId,value.actionId,value.sequence,payload);
      this.db.prepare('INSERT INTO record_artifacts VALUES(?,?)').run(value.runId,payload);
      for (const id of value.evidenceIds) this.db.prepare('INSERT OR IGNORE INTO record_artifacts VALUES(?,?)').run(value.runId,id);
    })(); } catch (error) { this.db.prepare('UPDATE artifacts SET pending_delete=1 WHERE id=?').run(payload); this.flushDeletes(); throw error; }
  }
  getActions(runId: string): ActionResult[] {
    if (!this.getRun(runId)) return [];
    return (this.db.prepare('SELECT payload_id FROM action_results WHERE run_id=? ORDER BY sequence').all(runId) as { payload_id: string }[]).map(row => ActionResult.parse(JSON.parse(this.readArtifact(row.payload_id).toString())));
  }
  private stale(id: string) {
    this.db.prepare(`WITH RECURSIVE affected(id) AS (SELECT ? UNION SELECT d.owner_id FROM dependencies d JOIN affected a ON d.source_id=a.id)
      UPDATE records SET stale=1 WHERE id IN (SELECT id FROM affected)`).run(id);
  }
  private removeRecords(ids: string[]) {
    this.db.transaction(() => {
      for (const id of new Set(ids)) {
        this.stale(id);
        const artifacts = this.db.prepare('SELECT artifact_id FROM record_artifacts WHERE record_id=?').all(id) as { artifact_id: string }[];
        for (const { artifact_id } of artifacts) this.markDelete(artifact_id);
        this.db.prepare('DELETE FROM records WHERE id=?').run(id);
      }
    })(); this.flushDeletes();
  }
  private markDelete(id: string) {
    const owners = this.db.prepare('SELECT record_id FROM record_artifacts WHERE artifact_id=?').all(id) as { record_id: string }[];
    for (const owner of owners) this.stale(owner.record_id);
    this.db.prepare('UPDATE artifacts SET pending_delete=1 WHERE id=?').run(id);
  }
  deleteDemonstration(id: string) {
    Id.parse(id);
    const row=this.db.prepare("SELECT id FROM records WHERE id=? AND kind='demonstration'").get(id);
    if (!row) return;
    const sources=this.db.prepare('WITH RECURSIVE source(id) AS (SELECT source_id FROM dependencies WHERE owner_id=? UNION SELECT d.source_id FROM dependencies d JOIN source s ON d.owner_id=s.id) SELECT id FROM source').all(id) as {id:string}[];
    this.removeRecords([id,...sources.map(r=>r.id)]);
  }
  deleteEvidence(id: string) { this.removeRecords([Id.parse(id)]); }
  expire() {
    this.ensureOpen();
    const ids = this.db.prepare('SELECT id FROM records WHERE expires_at<=?').all(this.now()) as { id: string }[];
    this.removeRecords(ids.map(row => row.id));
    this.db.transaction(() => {
      const expired = this.db.prepare('SELECT id FROM artifacts WHERE expires_at<=? AND pending_delete=0').all(this.now()) as { id: string }[];
      for (const row of expired) this.markDelete(row.id);
    })(); this.flushDeletes();
    return ids.length;
  }
  private flushDeletes() {
    for (const row of this.db.prepare('SELECT id FROM artifacts WHERE pending_delete=1').all() as { id: string }[]) {
      try { unlinkSync(this.path(row.id)); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw new Error('artifact-deletion-pending'); }
      // An encrypted record whose payload expires is retained as a stale tombstone
      // until explicitly deleted, so keep its catalog artifact row, unreadable.
      if (!this.db.prepare('SELECT id FROM records WHERE payload_id=?').get(row.id) && !this.db.prepare('SELECT id FROM action_results WHERE payload_id=?').get(row.id)) this.db.prepare('DELETE FROM artifacts WHERE id=?').run(row.id);
    }
  }
  private recover() {
    for (const name of readdirSync(this.artifactDir)) {
      const extension = this.unencrypted ? '.plain' : '.enc';
      if (!/^[a-f0-9-]{36}$/.test(name.slice(0,-extension.length)) || !name.endsWith(extension)) throw new Error('unexpected-artifact-file');
      const id = name.slice(0,-extension.length);
      if (!this.db.prepare('SELECT id FROM artifacts WHERE id=?').get(id)) unlinkSync(this.path(id));
    }
    this.flushDeletes();
  }
  stats() {
    return { records: (this.db.prepare('SELECT COUNT(*) AS n FROM records').get() as { n: number }).n,
      artifacts: (this.db.prepare('SELECT COUNT(*) AS n FROM artifacts WHERE pending_delete=0').get() as { n: number }).n,
      bytes: (this.db.prepare('SELECT COALESCE(SUM(bytes),0) AS n FROM artifacts WHERE pending_delete=0').get() as { n: number }).n };
  }
  close() { if (!this.closed) { this.db.close(); this.closed = true; this.key.fill(0); unlinkSync(this.lockPath); } }
}
