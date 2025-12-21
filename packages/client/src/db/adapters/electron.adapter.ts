/**
 * Electron adapter for SQLite using better-sqlite3-multiple-ciphers.
 * Communicates with the main process via IPC.
 */

import type { DatabaseAdapter, DatabaseConfig, QueryResult } from './types';

// Type for the electron API exposed via preload
interface ElectronSqliteApi {
  sqlite: {
    initialize: (config: {
      name: string;
      encryptionKey: number[];
    }) => Promise<void>;
    close: () => Promise<void>;
    execute: (sql: string, params?: unknown[]) => Promise<QueryResult>;
    executeMany: (statements: string[]) => Promise<void>;
    beginTransaction: () => Promise<void>;
    commit: () => Promise<void>;
    rollback: () => Promise<void>;
    rekey: (newKey: number[]) => Promise<void>;
    deleteDatabase: (name: string) => Promise<void>;
  };
}

function getElectronApi(): ElectronSqliteApi {
  const api = (window as unknown as { electron?: ElectronSqliteApi }).electron;
  if (!api?.sqlite) {
    throw new Error('Electron SQLite API not available');
  }
  return api;
}

export class ElectronAdapter implements DatabaseAdapter {
  private initialized = false;

  async initialize(config: DatabaseConfig): Promise<void> {
    const api = getElectronApi();

    await api.sqlite.initialize({
      name: config.name,
      encryptionKey: Array.from(config.encryptionKey)
    });

    this.initialized = true;
  }

  async close(): Promise<void> {
    if (this.initialized) {
      const api = getElectronApi();
      await api.sqlite.close();
      this.initialized = false;
    }
  }

  isOpen(): boolean {
    return this.initialized;
  }

  async execute(sql: string, params?: unknown[]): Promise<QueryResult> {
    const api = getElectronApi();
    return api.sqlite.execute(sql, params);
  }

  async executeMany(statements: string[]): Promise<void> {
    const api = getElectronApi();
    await api.sqlite.executeMany(statements);
  }

  async beginTransaction(): Promise<void> {
    const api = getElectronApi();
    await api.sqlite.beginTransaction();
  }

  async commitTransaction(): Promise<void> {
    const api = getElectronApi();
    await api.sqlite.commit();
  }

  async rollbackTransaction(): Promise<void> {
    const api = getElectronApi();
    await api.sqlite.rollback();
  }

  async rekeyDatabase(newKey: Uint8Array): Promise<void> {
    const api = getElectronApi();
    await api.sqlite.rekey(Array.from(newKey));
  }

  getConnection(): unknown {
    // For Drizzle, return an executor function
    return async (
      sql: string,
      params: unknown[],
      method: 'all' | 'get' | 'run'
    ) => {
      const result = await this.execute(sql, params);

      if (method === 'run') {
        return {
          changes: result.changes,
          lastInsertRowId: result.lastInsertRowId
        };
      }

      if (method === 'get') {
        return result.rows[0] ?? null;
      }

      return result.rows;
    };
  }

  async deleteDatabase(name: string): Promise<void> {
    const api = getElectronApi();
    await api.sqlite.deleteDatabase(name);
    this.initialized = false;
  }
}
