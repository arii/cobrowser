# 007: Start the companion when Keychain access is unavailable

November 7, 2026 follow-up. The normal companion exited before displaying a window when its production key provider failed. The original smoke run used an ephemeral key, so it did not establish production Keychain availability.

Live diagnostics on this machine:

- Electron 45.2.3 async `isAsyncEncryptionAvailable()` returned true, but encrypting synthetic text failed. The documented availability method did not prove a usable encryption key.
- Explicitly enabling `UseKeychainKeyProvider` did not resolve it; that was a rejected hypothesis, not the fix.
- The synchronous Keychain API also reported unavailable. No synchronous/plaintext fallback was introduced.
- Native Security.framework reported the default login Keychain unlocked/readable/writable, yet adding a uniquely named synthetic generic-password item returned `errSecAuthFailed` (-25293). Reading that item returned not found (-25300), so no item was created. No existing item or credential was read, reset or deleted.
- The downloaded Electron app has an ad-hoc signature. Its signing state is observed, but it was not established as the cause; the native probe also failed. The precise underlying Keychain authentication policy requires user/OS intervention.

The startup fix keeps the desktop shell available with an explicit unavailable state, null storage statistics, a safe error code and an owner-frame-only retry IPC method. Observation/cloud processing remain off. The normal provider still uses macOS Keychain-backed async safeStorage; failure does not fall back, overwrite existing keys or create a plaintext catalog. Error reporting redacts arbitrary platform exception messages. The retry operation is for after the user restores Keychain access; it does not grant permissions or bypass macOS authentication.

Wrapped-key logic was extracted behind an injectable OS encryption interface. New unit cases check available-but-denied encryption (no files written), unavailable backend, denied decryption preserving existing data, missing-key refusal and safe diagnostic redaction. The unavailable Electron smoke is explicitly mocked and proves shell/IPC/retry behavior only. All 19 tests passed, typecheck/lint/build passed, and normal encrypted ephemeral-storage smoke passed. See [tests](evidence/keychain-startup/tests.log), [normal smoke](evidence/keychain-startup/normal-smoke.log), and [denied-provider smoke](evidence/keychain-startup/unavailable-smoke.log).

The actual normal companion was launched and its accessibility tree showed “Observation is off”, “Storage unavailable”, the `keychain-encryption-failed` code, Retry storage and Refresh storage status. It remained running rather than exiting. The user's foundation data directory remained empty: no artifact key or SQLite catalog was created under denied authorization.

Production Keychain persistence is still blocked, not marked complete. The next prerequisite is successful macOS authorization for this app's Keychain operations; being unlocked alone was insufficient in this diagnostic run. Existing Phase 1 evidence remains a historical snapshot; this follow-up changes startup/error handling only.

Primary references checked November 7, 2026: [Electron safeStorage](https://www.electronjs.org/docs/latest/api/safe-storage), [Electron 45.2.3 implementation](https://github.com/electron/electron/blob/v45.2.3/shell/browser/api/electron_api_safe_storage.cc), [Keychain provider setup](https://github.com/electron/electron/blob/v45.2.3/shell/browser/browser_process_impl.cc). Native OSStatus values were measured directly; no change to system security settings was attempted.
