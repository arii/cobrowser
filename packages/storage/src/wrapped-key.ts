import { existsSync, lstatSync, readFileSync, writeFileSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import type { KeyProvider } from './index.js';

export interface SecureStringStore {
  available(): Promise<boolean>;
  encrypt(value: string): Promise<Buffer>;
  decrypt(value: Buffer): Promise<{result: string; shouldReEncrypt: boolean}>;
}
// The platform backend must protect strings with the OS key store. There is no
// insecure fallback and no regeneration over an existing encrypted catalog.
export class WrappedKeyProvider implements KeyProvider {
  constructor(private readonly root: string, private readonly secure: SecureStringStore) {}
  async getKey(): Promise<Buffer> {
    const path=join(this.root,'artifact-key.wrapped');
    if (!existsSync(path) && existsSync(join(this.root,'catalog.sqlite'))) throw new Error('artifact-key-missing-for-existing-store');
    let available: boolean;
    try { available=await this.secure.available(); } catch { throw new Error('macos-keychain-unavailable'); }
    if (!available) throw new Error('macos-keychain-unavailable');
    if (existsSync(path)) {
      const st=lstatSync(path);
      if (!st.isFile() || st.isSymbolicLink() || st.uid!==process.getuid?.() || (st.mode & 0o077)) throw new Error('unsafe-wrapped-key-file');
      let decrypted: {result:string;shouldReEncrypt:boolean};
      try { decrypted=await this.secure.decrypt(readFileSync(path)); } catch { throw new Error('keychain-decryption-failed'); }
      if (!/^[A-Za-z0-9+/]{43}=$/.test(decrypted.result)) throw new Error('invalid-wrapped-key');
      const key=Buffer.from(decrypted.result,'base64');
      if (key.length!==32) throw new Error('invalid-wrapped-key');
      if (decrypted.shouldReEncrypt) {
        let wrapped: Buffer;
        try { wrapped=await this.secure.encrypt(key.toString('base64')); } catch { key.fill(0);throw new Error('keychain-encryption-failed'); }
        const temporary=`${path}.rotation-${process.pid}`;
        writeFileSync(temporary,wrapped,{mode:0o600,flag:'wx'});renameSync(temporary,path);
      }
      return key;
    }
    const key=randomBytes(32);
    try {
      let wrapped: Buffer;
      try { wrapped=await this.secure.encrypt(key.toString('base64')); } catch { throw new Error('keychain-encryption-failed'); }
      writeFileSync(path,wrapped,{mode:0o600,flag:'wx'});
      return key;
    } catch (error) { key.fill(0);throw error; }
  }
}
