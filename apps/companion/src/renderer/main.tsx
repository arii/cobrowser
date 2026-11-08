import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './style.css';
type Status = { phase: number; storageProtection: 'encrypted'|'unencrypted'; observationEnabled: boolean; cloudProcessingEnabled: boolean; storage: { records: number; artifacts: number; bytes: number }|null; storageState:'ready'|'unavailable';storageError:{code:string;message:string}|null;keyProvider: string; nativeBridge: string; models: string };
declare global { interface Window { harness?: { status(): Promise<Status>;retryStorage():Promise<Status>;restart():Promise<{restarting:boolean;mode:string}> } } }
function Foundation() {
  const [status,setStatus] = useState<Status>();
  const [error,setError] = useState('');
  const [retrying,setRetrying] = useState(false);
  const [restarting,setRestarting] = useState(false);
  const keychainFailure=status?.storageError && ['macos-keychain-unavailable','keychain-encryption-failed','keychain-decryption-failed'].includes(status.storageError.code);
  const refresh = async () => {
    try {
      if (!window.harness) throw new Error('Open this view in the desktop companion.');
      setStatus(await window.harness.status()); setError('');
    } catch { setError('Storage status is unavailable. Open this view in the desktop companion.'); }
  };
  const retryStorage=async()=>{
    setRetrying(true);
    try {if (!window.harness) throw new Error('companion-required');setStatus(await window.harness.retryStorage());setError('');}
    catch {setError('Could not retry storage. Reopen the desktop companion.');}
    finally {setRetrying(false);}
  };
  const restart=async()=>{
    setRestarting(true);
    try {if (!window.harness) throw new Error('companion-required');await window.harness.restart();}
    catch {setError('Could not restart automatically. Quit the companion and run pnpm dev:companion again.');setRestarting(false);}
  };
  useEffect(() => { void refresh(); }, []);
  return <main><p>VISUAL HARNESS · FOUNDATION</p><h1>Observation is off</h1>
    <p>This build establishes local storage and contracts. Browser observation, workflow learning and execution are not enabled.</p>
    {status?.storageState==='unavailable' && <section role="alert"><h2>Storage unavailable</h2>
      <p>{status.storageError?.message}</p><p>No observations are being saved. Existing encrypted data stays unchanged.</p>
      {keychainFailure && <><p>If the keychain appears unlocked but nothing prompts:</p>
      <ol><li>In Keychain Access, select <strong>login</strong> under Default Keychains.</li>
      <li>Right-click login and choose Lock Keychain “login”.</li>
      <li>Right-click it again, choose Unlock Keychain “login”, and enter its password in the macOS dialog.</li>
      <li>Restart this companion so it initializes encryption again.</li></ol>
      <p>Do not reset or delete the keychain. If unlocking fails, stop and keep the existing keychain.</p></>}
      <p>Error: <code>{status.storageError?.code}</code></p>
      {keychainFailure?<button onClick={()=>void restart()} disabled={restarting}>{restarting?'Restarting…':'Restart companion'}</button>:
      <button onClick={()=>void retryStorage()} disabled={retrying}>{retrying?'Retrying…':'Retry storage'}</button>}</section>}
    {status && <dl><dt>Local storage</dt><dd>{status.storage?`${status.storage.records} records · ${status.storage.artifacts} artifacts · ${status.storage.bytes} bytes`:'Unavailable'}</dd><dt>Browser relay</dt><dd>{status.nativeBridge}</dd><dt>Cloud processing</dt><dd>Off</dd></dl>}
    {error && <p role="alert">{error}</p>}<button onClick={() => void refresh()}>Refresh storage status</button></main>;
}
createRoot(document.getElementById('root')!).render(<Foundation/>);
