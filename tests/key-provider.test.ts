import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp,readFile,readdir,rm,writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WrappedKeyProvider,type SecureStringStore } from '../packages/storage/src/wrapped-key.js';
import { startupError } from '../apps/companion/src/startup-error.js';

test('available-but-denied Keychain encryption does not write a key or start a plaintext store',async()=>{
  const root=await mkdtemp(join(tmpdir(),'harness-key-denied-'));
  try {
    const secure:SecureStringStore={available:async()=>true,encrypt:async()=>{throw new Error('untrusted platform error');},decrypt:async()=>{throw new Error('unused');}};
    await assert.rejects(new WrappedKeyProvider(root,secure).getKey(),/^Error: keychain-encryption-failed$/);
    assert.deepEqual(await readdir(root),[]);
    await assert.rejects(new WrappedKeyProvider(root,{...secure,available:async()=>false}).getKey(),/macos-keychain-unavailable/);
    assert.deepEqual(await readdir(root),[]);
  } finally {await rm(root,{recursive:true,force:true});}
});
test('denied decryption and missing keys preserve existing data and never regenerate a key',async()=>{
  const root=await mkdtemp(join(tmpdir(),'harness-key-preserve-'));
  const wrapped=Buffer.from('synthetic-wrapped-fixture-not-real-encryption');
  let encryptCalls=0,availabilityCalls=0;
  const secure:SecureStringStore={available:async()=>{availabilityCalls++;return true;},encrypt:async()=>{encryptCalls++;throw new Error('must-not-create-replacement');},decrypt:async()=>{throw new Error('denied');}};
  try {
    await writeFile(join(root,'catalog.sqlite'),'synthetic-catalog-marker',{mode:0o600});
    await assert.rejects(new WrappedKeyProvider(root,secure).getKey(),/artifact-key-missing-for-existing-store/);
    assert.equal(availabilityCalls,0);assert.equal(encryptCalls,0);
    await writeFile(join(root,'artifact-key.wrapped'),wrapped,{mode:0o600});
    await assert.rejects(new WrappedKeyProvider(root,secure).getKey(),/keychain-decryption-failed/);
    assert.deepEqual(await readFile(join(root,'artifact-key.wrapped')),wrapped);
    assert.equal(await readFile(join(root,'catalog.sqlite'),'utf8'),'synthetic-catalog-marker');
    assert.equal(encryptCalls,0);
  } finally {await rm(root,{recursive:true,force:true});}
});
test('startup diagnostics expose only fixed safe codes, never provider error bodies or secrets',()=>{
  assert.equal(startupError(new Error('keychain-encryption-failed')).code,'keychain-encryption-failed');
  assert.equal(startupError(Object.assign(new Error('secret credential string'),{code:'EACCES'})).code,'EACCES');
  assert.equal(JSON.stringify(startupError(new Error('secret credential string'))).includes('secret credential'),false);
  assert.equal(startupError(new Error('__proto__')).code,'storage-initialization-failed');
});
