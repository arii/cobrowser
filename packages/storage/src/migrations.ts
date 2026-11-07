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
` }] as const;
