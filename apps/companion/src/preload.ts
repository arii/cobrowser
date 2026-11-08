import { contextBridge, ipcRenderer } from 'electron';
contextBridge.exposeInMainWorld('harness', Object.freeze({ status: () => ipcRenderer.invoke('foundation:status'), retryStorage:()=>ipcRenderer.invoke('foundation:retry-storage'),restart:()=>ipcRenderer.invoke('foundation:restart') }));
