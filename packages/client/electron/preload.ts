import {electronAPI} from '@electron-toolkit/preload';
import {contextBridge, ipcRenderer} from 'electron';

// Custom APIs for renderer
const api = {
  openExternal: async (url: string): Promise<void> => {
    return ipcRenderer.invoke('open-external', url);
  },
};

// Use `contextBridge` APIs to expose Electron APIs to renderer
if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electron', electronAPI);
    contextBridge.exposeInMainWorld('api', api);
  } catch (error) {
    console.error(error);
  }
} else {
  console.error(
    'Context isolation is not enabled. This is a security risk.'
  );
}
