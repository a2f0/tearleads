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
  // Key storage (namespaced by instanceId)
  getSalt: (instanceId: string): Promise<number[] | null> => {
    return ipcRenderer.invoke('sqlite:getSalt', instanceId);
  },
  setSalt: (salt: number[], instanceId: string): Promise<void> => {
    return ipcRenderer.invoke('sqlite:setSalt', salt, instanceId);
  },
  getKeyCheckValue: (instanceId: string): Promise<string | null> => {
    return ipcRenderer.invoke('sqlite:getKeyCheckValue', instanceId);
  },
  setKeyCheckValue: (kcv: string, instanceId: string): Promise<void> => {
    return ipcRenderer.invoke('sqlite:setKeyCheckValue', kcv, instanceId);
  },
  clearKeyStorage: (instanceId: string): Promise<void> => {
    return ipcRenderer.invoke('sqlite:clearKeyStorage', instanceId);
  },
  // Session persistence operations (namespaced by instanceId)
  getWrappingKey: (instanceId: string): Promise<number[] | null> => {
    return ipcRenderer.invoke('sqlite:getWrappingKey', instanceId);
  },
  setWrappingKey: (keyBytes: number[], instanceId: string): Promise<void> => {
    return ipcRenderer.invoke('sqlite:setWrappingKey', keyBytes, instanceId);
  },
  getWrappedKey: (instanceId: string): Promise<number[] | null> => {
    return ipcRenderer.invoke('sqlite:getWrappedKey', instanceId);
  },
  setWrappedKey: (wrappedKey: number[], instanceId: string): Promise<void> => {
    return ipcRenderer.invoke('sqlite:setWrappedKey', wrappedKey, instanceId);
  },
  hasSession: (instanceId: string): Promise<boolean> => {
    return ipcRenderer.invoke('sqlite:hasSession', instanceId);
  },
  clearSession: (instanceId: string): Promise<void> => {
    return ipcRenderer.invoke('sqlite:clearSession', instanceId);
  },
  deleteDatabase: (name: string): Promise<void> => {
    return ipcRenderer.invoke('sqlite:deleteDatabase', name);
  },
  export: (name: string): Promise<number[]> => {
    return ipcRenderer.invoke('sqlite:export', name);
  },
  import: (name: string, data: number[], key: number[]): Promise<void> => {
    return ipcRenderer.invoke('sqlite:import', name, data, key);
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
