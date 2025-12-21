import {electronAPI} from '@electron-toolkit/preload';
import {contextBridge, ipcRenderer} from 'electron';

// SQLite API for renderer
const sqlite = {
  initialize: (config: { name: string; encryptionKey: number[] }): Promise<void> => {
    return ipcRenderer.invoke('sqlite:initialize', config);
  },
  close: (): Promise<void> => {
    return ipcRenderer.invoke('sqlite:close');
  },
  execute: (sql: string, params?: unknown[]): Promise<unknown> => {
    return ipcRenderer.invoke('sqlite:execute', sql, params);
  },
  executeMany: (statements: string[]): Promise<void> => {
    return ipcRenderer.invoke('sqlite:executeMany', statements);
  },
  beginTransaction: (): Promise<void> => {
    return ipcRenderer.invoke('sqlite:beginTransaction');
  },
  commit: (): Promise<void> => {
    return ipcRenderer.invoke('sqlite:commit');
  },
  rollback: (): Promise<void> => {
    return ipcRenderer.invoke('sqlite:rollback');
  },
  rekey: (newKey: number[]): Promise<void> => {
    return ipcRenderer.invoke('sqlite:rekey', newKey);
  },
  // Key storage
  getSalt: (): Promise<number[] | null> => {
    return ipcRenderer.invoke('sqlite:getSalt');
  },
  setSalt: (salt: number[]): Promise<void> => {
    return ipcRenderer.invoke('sqlite:setSalt', salt);
  },
  getKeyCheckValue: (): Promise<string | null> => {
    return ipcRenderer.invoke('sqlite:getKeyCheckValue');
  },
  setKeyCheckValue: (kcv: string): Promise<void> => {
    return ipcRenderer.invoke('sqlite:setKeyCheckValue', kcv);
  },
  clearKeyStorage: (): Promise<void> => {
    return ipcRenderer.invoke('sqlite:clearKeyStorage');
  },
  deleteDatabase: (name: string): Promise<void> => {
    return ipcRenderer.invoke('sqlite:deleteDatabase', name);
  },
};

// Custom APIs for renderer
const api = {
  openExternal: async (url: string): Promise<void> => {
    return ipcRenderer.invoke('open-external', url);
  },
};

// Use `contextBridge` APIs to expose Electron APIs to renderer
if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electron', { ...electronAPI, sqlite });
    contextBridge.exposeInMainWorld('api', api);
  } catch (error) {
    console.error(error);
  }
} else {
  console.error(
    'Context isolation is not enabled. This is a security risk.'
  );
}
