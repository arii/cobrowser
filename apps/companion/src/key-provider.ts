import { safeStorage } from 'electron';
import { WrappedKeyProvider } from '../../../packages/storage/src/wrapped-key.js';

export class MacKeychainKeyProvider extends WrappedKeyProvider {
  constructor(root: string) {
    super(root,{
      available: async()=>process.platform==='darwin' && await safeStorage.isAsyncEncryptionAvailable(),
      encrypt: value=>safeStorage.encryptStringAsync(value),
      decrypt: value=>safeStorage.decryptStringAsync(value),
    });
  }
}
