import { app, BrowserWindow, ipcMain } from 'electron';
import { mkdirSync, lstatSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { HarnessStore, EphemeralKeyProvider } from '../../../packages/storage/src/index.js';
import { MacKeychainKeyProvider } from './key-provider.js';
import { startupError } from './startup-error.js';

app.setName('Visual Harness');
const unencryptedSmoke = process.argv.includes('--smoke-unencrypted');
const keychainMode = process.argv.includes('--keychain');
const unavailableSmoke = process.argv.includes('--smoke-keychain-unavailable');
const smoke = process.argv.includes('--smoke') || unavailableSmoke || unencryptedSmoke;
const unencryptedMode = (!keychainMode && !smoke) || unencryptedSmoke;
let store: HarnessStore | undefined;
let window: BrowserWindow | undefined;
let temporaryRoot: string | undefined;
let storageFailure: ReturnType<typeof startupError> | undefined;
let initialization: Promise<void> | undefined;
async function initializeStorage(root: string) {
  if (store) return;
  if (initialization) return initialization;
  initialization=(async()=>{
    try {
      mkdirSync(root,{recursive:true,mode:0o700});
      const st=lstatSync(root);
      if (!st.isDirectory() || st.isSymbolicLink() || st.uid!==process.getuid?.() || (st.mode & 0o077)) throw new Error('companion-data-directory-must-be-user-only');
      const provider=unavailableSmoke ? {getKey:async()=>{throw new Error('keychain-encryption-failed');}}
        : smoke ? new EphemeralKeyProvider() : new MacKeychainKeyProvider(root);
      store=unencryptedMode ? await HarnessStore.openUnencrypted(root) : await HarnessStore.open(root,provider);storageFailure=undefined;
    } catch(error) { storageFailure=startupError(error);console.error(JSON.stringify({event:'storage-unavailable',...storageFailure})); }
  })();
  try {await initialization;} finally {initialization=undefined;}
}
function foundationStatus() {
  return {phase:1,observationEnabled:false,cloudProcessingEnabled:false,storage:store?.stats()??null,
    storageState:store?'ready':'unavailable',storageError:storageFailure??null,
    storageProtection:unencryptedMode?'unencrypted':'encrypted',
    keyProvider:unencryptedMode?'none — unencrypted local files':unavailableSmoke?'mock-unavailable':smoke?'synthetic-ephemeral':'macOS-Keychain',nativeBridge:'not-connected',models:'live-unverified'};
}
void app.whenReady().then(async () => {
  const root = smoke ? (temporaryRoot = mkdtempSync(join(tmpdir(), 'harness-electron-'))) : join(app.getPath('userData'),keychainMode?'foundation':'foundation-unencrypted');
  await initializeStorage(root);
  const retention = setInterval(() => {
    try { store?.expire(); } catch { console.error('Storage maintenance failed; observation remains disabled.'); }
  }, 60000);
  retention.unref();
  window = new BrowserWindow({ width: 720, height: 460, show: !smoke,
    webPreferences: { preload: join(__dirname,'preload.cjs'), nodeIntegration: false, contextIsolation: true, sandbox: true } });
  window.webContents.setWindowOpenHandler(() => ({action:'deny'}));
  window.webContents.on('will-navigate', event => event.preventDefault());
  function trustedSender(event: Electron.IpcMainInvokeEvent) {
    if (event.sender !== window?.webContents || event.senderFrame !== window.webContents.mainFrame) throw new Error('untrusted-ipc-sender');
  }
  ipcMain.handle('foundation:status', event => {trustedSender(event);return foundationStatus();});
  ipcMain.handle('foundation:retry-storage',async event=>{trustedSender(event);await initializeStorage(root);return foundationStatus();});
  ipcMain.handle('foundation:restart',event=>{
    trustedSender(event);
    if (smoke) return {restarting:false,mode:'smoke-no-relaunch'};
    setTimeout(()=>{app.relaunch();app.quit();},150);
    return {restarting:true,mode:'normal'};
  });
  await window.loadFile(join(__dirname,'renderer/index.html'));
  if (smoke) {
    const ipcStatus = await window.webContents.executeJavaScript('window.harness.status()');
    if (unavailableSmoke) {
      if (ipcStatus.storageState!=='unavailable' || ipcStatus.storage!==null || ipcStatus.storageError?.code!=='keychain-encryption-failed' || ipcStatus.observationEnabled!==false) throw new Error('unavailable-storage-smoke-failed');
      const retried=await window.webContents.executeJavaScript('window.harness.retryStorage()');
      if (retried.storageState!=='unavailable') throw new Error('unavailable-storage-retry-smoke-failed');
      const restart=await window.webContents.executeJavaScript('window.harness.restart()');
      if (restart.mode!=='smoke-no-relaunch') throw new Error('unavailable-storage-restart-smoke-failed');
      console.log(JSON.stringify({mode:'live-electron-shell-with-mocked-keychain-denial',rendererLoaded:true,isolatedPreloadIPC:true,storageState:ipcStatus.storageState,errorCode:ipcStatus.storageError.code,retryResponded:true,restartIPCResponded:true,relaunchSuppressedInSmoke:true,observationEnabled:false,keychainTested:false}));
      app.quit();return;
    }
    if (ipcStatus.observationEnabled !== false || ipcStatus.storageProtection !== (unencryptedSmoke?'unencrypted':'encrypted') || !store) throw new Error('companion-ipc-smoke-failed');
    const status = store.stats();
    const bytes = Buffer.from('synthetic-electron-native-roundtrip');
    const id = store.putArtifact(bytes);
    if (unencryptedSmoke) {store.close();store=await HarnessStore.openUnencrypted(root);}
    if (!store.readArtifact(id).equals(bytes)) throw new Error('electron-storage-smoke-failed');
    console.log(JSON.stringify({ mode: 'live-electron-smoke', electron: process.versions.electron, node: process.versions.node,
      sqlite: unencryptedSmoke?'read-write-unencrypted-artifact-passed':'read-write-encrypted-artifact-passed', rendererLoaded: true, isolatedPreloadIPC: true, keyProvider: ipcStatus.keyProvider, keychainTested: false, initialStorage: status }));
    app.quit();
  }
}).catch(error => { console.error(JSON.stringify({event:'companion-startup-failed',...startupError(error)}));app.exit(1); });
app.on('window-all-closed', () => app.quit());
app.on('will-quit', () => { store?.close(); if (temporaryRoot) rmSync(temporaryRoot,{recursive:true,force:true}); });
