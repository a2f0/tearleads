/**
 * Electron main process SQLite handler.
 * Uses better-sqlite3-multiple-ciphers for encrypted database operations.
 */

import { ipcMain } from 'electron';
import {
  beginTransaction,
  closeDatabase,
  commit,
  execute,
  executeMany,
  initializeDatabase,
  rekey,
  rollback
} from './databaseOperations';
import { deleteDatabase, exportDatabase, importDatabase } from './importExport';
import {
  clearKeyStorage,
  clearSession,
  getKeyCheckValue,
  getSalt,
  getWrappedKey,
  getWrappingKey,
  hasSession,
  storeKeyCheckValue,
  storeSalt,
  storeWrappedKey,
  storeWrappingKey
} from './keyStorage';

/**
 * Register IPC handlers for SQLite operations.
 */
export function registerSqliteHandlers(): void {
  // Database operations
  ipcMain.handle(
    'sqlite:initialize',
    async (_event, config: { name: string; encryptionKey: number[] }) => {
      try {
        initializeDatabase(config);
      } catch (error) {
        console.error('sqlite:initialize error:', error);
        throw error;
      }
    }
  );

  ipcMain.handle('sqlite:close', () => {
    closeDatabase();
  });

  ipcMain.handle(
    'sqlite:execute',
    (_event, sql: string, params?: unknown[]) => {
      return execute(sql, params);
    }
  );

  ipcMain.handle('sqlite:executeMany', (_event, statements: string[]) => {
    executeMany(statements);
  });

  ipcMain.handle('sqlite:beginTransaction', () => {
    beginTransaction();
  });

  ipcMain.handle('sqlite:commit', () => {
    commit();
  });

  ipcMain.handle('sqlite:rollback', () => {
    rollback();
  });

  ipcMain.handle('sqlite:rekey', (_event, newKey: number[]) => {
    rekey(newKey);
  });

  // Key storage operations (namespaced by instanceId)
  ipcMain.handle('sqlite:getSalt', (_event, instanceId: string) => {
    return getSalt(instanceId);
  });

  ipcMain.handle('sqlite:setSalt', (_event, salt: number[], instanceId: string) => {
    storeSalt(salt, instanceId);
  });

  ipcMain.handle('sqlite:getKeyCheckValue', (_event, instanceId: string) => {
    return getKeyCheckValue(instanceId);
  });

  ipcMain.handle('sqlite:setKeyCheckValue', (_event, kcv: string, instanceId: string) => {
    storeKeyCheckValue(kcv, instanceId);
  });

  ipcMain.handle('sqlite:clearKeyStorage', (_event, instanceId: string) => {
    clearKeyStorage(instanceId);
  });

  // Session persistence operations (namespaced by instanceId)
  ipcMain.handle('sqlite:getWrappingKey', (_event, instanceId: string) => {
    return getWrappingKey(instanceId);
  });

  ipcMain.handle(
    'sqlite:setWrappingKey',
    (_event, keyBytes: number[], instanceId: string) => {
      storeWrappingKey(keyBytes, instanceId);
    }
  );

  ipcMain.handle('sqlite:getWrappedKey', (_event, instanceId: string) => {
    return getWrappedKey(instanceId);
  });

  ipcMain.handle(
    'sqlite:setWrappedKey',
    (_event, wrappedKey: number[], instanceId: string) => {
      storeWrappedKey(wrappedKey, instanceId);
    }
  );

  ipcMain.handle('sqlite:hasSession', (_event, instanceId: string) => {
    return hasSession(instanceId);
  });

  ipcMain.handle('sqlite:clearSession', (_event, instanceId: string) => {
    clearSession(instanceId);
  });

  ipcMain.handle('sqlite:deleteDatabase', (_event, name: string) => {
    deleteDatabase(name);
  });

  ipcMain.handle('sqlite:export', async (_event, name: string) => {
    const data = await exportDatabase(name);
    // Convert Buffer to number[] for IPC transfer
    return Array.from(data);
  });

  ipcMain.handle(
    'sqlite:import',
    async (_event, name: string, data: number[], key: number[]) => {
      await importDatabase(name, Buffer.from(data), key);
    }
  );
}

/**
 * Clean up on app quit.
 */
export function cleanupSqlite(): void {
  closeDatabase();
}
