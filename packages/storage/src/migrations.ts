export const migrations = [{ version: 1, sql: `
CREATE TABLE artifacts (
  id TEXT PRIMARY KEY, content_hash TEXT NOT NULL, bytes INTEGER NOT NULL,
  expires_at INTEGER NOT NULL, pending_delete INTEGER NOT NULL DEFAULT 0 CHECK(pending_delete IN (0,1))
);
CREATE TABLE records (
  id TEXT PRIMARY KEY, kind TEXT NOT NULL CHECK(kind IN ('event','frame','demonstration','revision','run','contract','suite')),
  payload_id TEXT NOT NULL REFERENCES artifacts(id), content_hash TEXT NOT NULL,
  created_at INTEGER NOT NULL, expires_at INTEGER, stale INTEGER NOT NULL DEFAULT 0 CHECK(stale IN (0,1))
);
CREATE TABLE record_artifacts (
  record_id TEXT NOT NULL REFERENCES records(id) ON DELETE CASCADE,
  artifact_id TEXT NOT NULL REFERENCES artifacts(id) ON DELETE CASCADE,
  PRIMARY KEY(record_id,artifact_id)
);
CREATE TABLE dependencies (
  owner_id TEXT NOT NULL REFERENCES records(id) ON DELETE CASCADE,
  source_id TEXT NOT NULL REFERENCES records(id) ON DELETE CASCADE,
  PRIMARY KEY(owner_id,source_id), CHECK(owner_id<>source_id)
);
CREATE TABLE hash_bindings (
  hash TEXT PRIMARY KEY, record_id TEXT NOT NULL UNIQUE REFERENCES records(id) ON DELETE CASCADE
);
CREATE TABLE revisions (
  id TEXT PRIMARY KEY REFERENCES records(id) ON DELETE CASCADE, skill_id TEXT NOT NULL,
  content_hash TEXT NOT NULL UNIQUE, state TEXT NOT NULL CHECK(state IN ('draft','queued','verifying','approved','blocked','inconclusive')),
  generation INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE runs (
  id TEXT PRIMARY KEY REFERENCES records(id) ON DELETE CASCADE,
  state TEXT NOT NULL CHECK(state IN ('created','running','paused','needs_user','succeeded','failed','cancelled')),
  generation INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE action_results (
  id TEXT PRIMARY KEY, run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  action_id TEXT NOT NULL, sequence INTEGER NOT NULL, payload_id TEXT NOT NULL REFERENCES artifacts(id),
  UNIQUE(run_id,sequence), UNIQUE(run_id,action_id)
);
CREATE TRIGGER immutable_record BEFORE UPDATE OF id,kind,payload_id,content_hash,created_at,expires_at ON records
BEGIN SELECT RAISE(ABORT,'immutable-record'); END;
CREATE TRIGGER immutable_revision BEFORE UPDATE OF id,skill_id,content_hash ON revisions
BEGIN SELECT RAISE(ABORT,'immutable-revision'); END;
CREATE TRIGGER append_only_actions BEFORE UPDATE ON action_results
BEGIN SELECT RAISE(ABORT,'append-only-action-results'); END;
CREATE INDEX retention_records ON records(expires_at);
CREATE INDEX retention_artifacts ON artifacts(expires_at);
` }, { version: 2, sql: `
CREATE TABLE verification_reports (
  id TEXT PRIMARY KEY, revision_id TEXT NOT NULL REFERENCES revisions(id),
  report_json TEXT NOT NULL, verdict TEXT NOT NULL,
  UNIQUE(revision_id,id)
);
CREATE TABLE active_skills (
  skill_id TEXT PRIMARY KEY, revision_id TEXT REFERENCES revisions(id),
  generation INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE quarantined_revisions (
  revision_id TEXT PRIMARY KEY REFERENCES revisions(id), report_id TEXT NOT NULL REFERENCES verification_reports(id)
);
CREATE TABLE registry_audit (
  sequence INTEGER PRIMARY KEY AUTOINCREMENT, skill_id TEXT NOT NULL,
  revision_id TEXT NOT NULL, previous_revision_id TEXT, report_id TEXT NOT NULL REFERENCES verification_reports(id),
  operation TEXT NOT NULL CHECK(operation IN ('approved','blocked','inconclusive','rollback','disabled')),
  created_at INTEGER NOT NULL
);
CREATE TRIGGER immutable_verification_report BEFORE UPDATE ON verification_reports
BEGIN SELECT RAISE(ABORT,'immutable-verification-report'); END;
CREATE TRIGGER append_only_registry_audit BEFORE UPDATE ON registry_audit
BEGIN SELECT RAISE(ABORT,'append-only-registry-audit'); END;
` }] as const;
