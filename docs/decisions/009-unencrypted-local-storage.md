# 009 — Explicit unencrypted local development storage

Date: 2026-11-07. Supersedes the default-startup requirement in decisions 007/008; their historical Keychain failure evidence remains valid.

## Authorization and change

The user explicitly requested plain text or unencrypted storage after macOS Keychain authentication failed and their attempted recovery reported missing administrator permission. Default companion startup now calls `HarnessStore.openUnencrypted` in `~/Library/Application Support/Visual Harness/foundation-unencrypted`. It never invokes Keychain. The existing `foundation` encrypted store is preserved, with no automatic migration or fallback. `pnpm dev:companion --keychain` selects the original encrypted mode explicitly; its OS prerequisite is still unresolved.

SQLite metadata remains unchanged. Payloads and artifacts are readable `.plain` files with a `VH00` header. No secret key is generated or persisted for this mode. SHA-256 checks detect accidental corruption; they are not cryptographic authentication against someone who can edit both catalog and files. Private directories/files (0700/0600), exclusive writer, retention, quotas, deletion recovery, immutable contracts and lifecycle checks remain in place. A mode marker prevents accidentally opening the plaintext catalog through the encrypted API; plaintext opening refuses an existing catalog without that marker. No existing content is decrypted or overwritten.

The README documents the mode and file readability. At the user’s subsequent request, the hackathon UI omits the storage warning and key-protection row. Credentials remain outside this store and source/logs. Observation and cloud processing remain off. This change provides real local persistence; it does not complete browser relay wiring, learning, execution or live models.

## Reproduction and evidence

Run from the repository:

```sh
pnpm typecheck
pnpm lint
pnpm test
pnpm build
pnpm smoke:companion:unencrypted
pnpm smoke:companion
pnpm dev:companion
```

Observed versions: Electron 45.2.3, embedded Node 24.22.2 (smoke output). Existing project dependency versions remain unchanged.

- Type checking, lint and build exited 0.
- All 20 unit tests passed. The new test writes readable synthetic content, closes the catalog, rejects encrypted-mode opening, reopens without any key, reads it back, corrupts the actual file and verifies read rejection. Existing encrypted-storage tests still pass.
- Live Electron unencrypted smoke exited 0: `read-write-unencrypted-artifact-passed`, `rendererLoaded:true`, `isolatedPreloadIPC:true`, `keyProvider:"none — unencrypted local files"`, `keychainTested:false`. It actually closes and reopens its temporary store before reading the saved artifact.
- Live Electron encrypted smoke exited 0 using the explicitly synthetic ephemeral key; this does not validate macOS Keychain.
- Restarted the normal companion through its existing Restart button. Native accessibility inspection showed `Unencrypted local storage.`, `0 records · 0 artifacts · 0 bytes`, `none — unencrypted local files`, and the responsive Refresh storage status button. Storage unavailable/Keychain instructions disappeared. This was the actual normal application, not a replay fixture.

No live model calls, capture permission changes, new provider mocks or Keychain success claims are part of this change. Earlier Phase 1 evidence files are historical snapshots and were not overwritten.

## Plan changes and next milestone

`plan.md` now records this user-authorized local-development exception and preserves optional encrypted mode as the production architecture proposal. This is a deliberate confidentiality tradeoff for local startup, not evidence that Keychain works. General dashboards, additional browser support and discovery remain deferred. Next implementation milestone remains Phase 2: bounded reporting skill execution with an independently supervised verifier and authenticated promotion gate.
