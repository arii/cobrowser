# 006: Phase 1 foundation and versioned contracts

Date: November 7, 2026. Status: local Phase 1 exit implemented and checked; Phase 0 live-provider/manual gates remain open. The requested Phase 1 work proceeds independently of those gates. No learner, general workflow execution, promotion gate or full dashboard is enabled.

## Implemented

- Thirteen pnpm workspace projects with exact dependency pins, lockfile, ESLint, three TypeScript projects, bundle/build scripts, ignored runtime outputs and `.env.example` without secrets.
- Schema version 1 for observation events, visual frames, demonstrations, task contracts, immutable declarative skill revisions, bounded action requests, frozen suites, reports, execution records and append-only action results. Browser-safe schemas are exported as `@harness/contracts/schemas`; Node hashing/ID/lifecycle helpers are exported from the root package. Both Node and browser bundles are built. Canonical JSON hashing sorts object keys and preserves array order, rejecting non-JSON input. This is a versioned local encoding, not a claim of complete RFC 8785 conformance.
- The browser transport interface preserves separate session/run/tab/window/document/origin/observation identity and measured screenshot-to-CSS mapping. It rejects stale actions, invalid observations, out-of-bounds clicks and scope mismatches. Concrete runtime transport integration and action authorization are later work.
- `better-sqlite3` migrations with frozen migration hashes, immutable-record triggers, exclusive owner-only writer lock, compare-and-swap lifecycle state updates and encrypted file-backed record bodies/artifacts. The catalog retains metadata such as IDs, hashes, dependencies, states and expiry times; it is not an encrypted whole database.
- AES-256-GCM envelopes with random IVs and authenticated artifact ID/schema/hash binding. Files/root are user-only. Raw evidence defaults to 24 hours (configurable shorter), demonstration bodies to 7 days (configurable up to 30 days), artifacts to a 64 MiB managed quota with a 16 MiB per-file bound. Revisions/contracts/suites retain immutable encrypted content independently of raw source retention.
- Immediate read-time expiry checks, scheduled desktop sweeps, dependency staleness, privacy deletion of demonstrations and their events/frames/artifacts, and crash cleanup of pending deletions/unregistered artifact files. Failed unlink prevents reads and further writes until cleanup succeeds. No thumbnail/cache stores exist. Filesystem removal does not erase backups/snapshots or promise physical SSD erasure.
- Contract/suite hash binding, revision parent/training-evidence checks, rejection of held-out/agent evidence for training, immutable revisions, terminal state validation and ordered duplicate-resistant action-result logs. Approval transitions explicitly fail with `authenticated-promotion-gate-not-implemented`; no active pointer exists yet. Execution records are bookkeeping and confer no authorization.
- Async macOS Keychain-backed `safeStorage` wrapping for the desktop artifact key, with no plaintext/environment fallback. The wrapped artifact key is stored locally; its OS wrapping protection uses Keychain. Missing/unreadable keys fail closed. Signing, interactive Keychain access and restart persistence with a production key remain manual acceptance work.
- Minimal Electron main/sandboxed preload/React renderer with read-only storage-status IPC, local-only assets, blocked navigation/new windows and observation/cloud processing off. WXT builds a Chrome MV3 extension with a React popup that reuses the real Phase 0 handlers and pinned extension ID. One-shot learner/verifier/registry worker entry points honestly report scaffold/disabled state.
- Typed provider capability interfaces with separate role context and explicit live/replay configuration, plus existing labeled hand-authored synthetic responses. No live-to-replay fallback. Generic generation/planning and task-specific decision interfaces remain later work.

## Reproduction and measured evidence

```sh
pnpm install --frozen-lockfile
pnpm exec playwright install chromium
pnpm verify:phase1
```

The check runner records actual exit codes and durations, stops on failure, and writes source/evidence hashes. See [commands](evidence/phase1/commands.json), [hashes](evidence/phase1/hashes.json), [foundation lifecycle](evidence/phase1/foundation.json), and [built popup](evidence/phase1/built-popup.json). The logs in that directory are generated from actual subprocess output, not declarations of assumed success. `pnpm verify:foundation` is the small standalone Phase 1 exit demonstration.

The final checks cover:

| Check | Evidence |
| --- | --- |
| Frozen install, lint, three typecheck projects | Command exits/logs in the evidence directory |
| Offline boundary tests | 16 tests: hash/schema/action boundaries, encryption/tampering/wrong key, retention/deletion/recovery, immutable contract/suite/revision, state CAS, held-out/agent exclusions and provider error/replay behavior |
| Complete build | Electron main/preload/React assets, WXT Chrome MV3, Node/browser contract/adapter bundles and worker entry points |
| Electron native compatibility | `better-sqlite3` source rebuilt in a staged copy; Electron renderer/preload IPC and encrypted SQLite artifact round trip passed; Node test binding unchanged |
| Synthetic lifecycle | Stored/retrieved/reopened demonstration, expired source evidence, stale derived revision, deleted records/files, rejected mutation and invalid transition |
| Regression integration | Real CSV download cases still accept 3 correct artifacts and reject 3 wrong-week outputs despite success messages; raw and WXT popup click handlers drive real screenshot/CDP typing; missing-host feedback remains explicit |
| Worker entry points | Learner/verifier/registry start and report disabled scaffold state |

Pinned additions: Electron 45.2.3 (observed embedded Node 24.22.2), SQLite package 13.0.3, React 19.3.1, Vite 8.3.6, WXT 0.21.5, ESLint 10.14.0, TypeScript 5.9.3. Host Node is 24.13.0/pnpm 11.25.0, macOS 26.5.2 arm64. Dependencies and transitive resolution are locked. Existing Playwright 1.65.0/Chrome for Testing 158.0.8127.18 remain pinned for browser probes.

## Decisions and limits

SQLite 13 uses Node-API prebuilds rather than the older Node/Electron ABI-specific assumption. A packaged prebuild worked inside Electron, and an explicit source rebuild also worked. The build stages a separate module copy; `rebuild:electron` removes that copy's prebuilds and compiles against pinned Electron headers. This avoids breaking the normal Node test binding. Rebuilding is a separate explicit command after a build, since rebuilding all source on every edit would be unnecessary. The measured release-like check does both.

Electron 45 deprecates synchronous safeStorage, so the key provider uses the asynchronous API. The automatic Electron checks use an explicitly synthetic ephemeral key and never request Keychain access. They prove SQLite/Electron/encryption/IPC compatibility, not production Keychain persistence. No OS privacy setting was modified. See [Electron safeStorage](https://www.electronjs.org/docs/latest/api/safe-storage) and [native modules](https://www.electronjs.org/docs/latest/tutorial/using-native-node-modules), checked November 7, 2026.

Basic tests retain the offline Node test runner from Phase 0; no Vitest migration is needed for this exit criterion. Provider responses remain hand-authored replay fixtures or mocked failure transports; live Llama/Snap are still blocked by missing configuration/credentials. Observation capture is off. Installed consumer-Chrome and permission-revocation/regrant checks remain manual. Docker is absent, and worker names/contexts do not establish OS isolation or held-out-data secrecy. The same-user administrator/developer threat remains outside this local prototype.

Phase 1 defines but does not authenticate report schemas. Required failed/missing assertions cannot parse as approved, but a structurally valid signature is not a verified signature. No code path promotes a revision or dispatches a skill. Lifecycle helpers describe the approved transition for a future trusted gate; storage deliberately refuses it until Phase 2 implements and tests authorization.

The next milestone is Phase 2: provision a protected verifier/candidate boundary, frozen scenario inputs, shared bounded skill interpreter and CDP transport implementation, outcome/effect assertions and an authenticated exact-hash promotion gate. Close the outstanding live-provider/manual prerequisites before claiming those integrations. Keep continuous observation, learning and dashboard expansion deferred.
