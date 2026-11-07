const messages: Record<string,string>={
  'storage-protection-mode-mismatch':'This directory uses a different storage mode. Keep encrypted and unencrypted stores in separate directories.',
  'macos-keychain-unavailable':'macOS Keychain is unavailable. Restore Keychain access, then restart the companion.',
  'keychain-encryption-failed':'macOS Keychain could not protect the storage key. Restore Keychain access, then restart the companion.',
  'keychain-decryption-failed':'macOS Keychain could not unlock the existing storage key. Restore Keychain access, then restart the companion. Your encrypted data has been kept.',
  'artifact-key-missing-for-existing-store':'The wrapped key for the existing encrypted store is missing. Restore its key file; a replacement key will not be created.',
  'unsafe-wrapped-key-file':'The wrapped key file must be a regular user-owned file with owner-only permissions.',
  'invalid-wrapped-key':'The existing wrapped key is invalid. Your encrypted data has been kept.',
  'companion-data-directory-must-be-user-only':'The companion data directory must be user-owned with owner-only permissions.',
  'storage-directory-must-be-user-only':'The storage directory must be user-owned with owner-only permissions.',
  'storage-already-open':'Another companion process has this store open. Close it and retry.',
  'migration-hash-mismatch':'The catalog migration history differs from this build. Your data has been kept; review the migration before opening it.',
};
export function startupError(error: unknown) {
  const key=error instanceof Error ? error.message : '';
  if (Object.hasOwn(messages,key)) return {code:key,message:messages[key]};
  const code=(error as NodeJS.ErrnoException|undefined)?.code;
  if (code && ['EACCES','EPERM','ENOSPC','EROFS','EIO'].includes(code)) return {code,message:'Storage is unavailable because of filesystem access or space. Check data-directory access and free disk space, then retry.'};
  return {code:'storage-initialization-failed',message:'Storage initialization failed. Your data has been kept. Review the build and native SQLite setup before retrying.'};
}
