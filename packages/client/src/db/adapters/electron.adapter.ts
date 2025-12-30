/**
 * Electron adapter for SQLite using better-sqlite3-multiple-ciphers.
 * Communicates with the main process via IPC.
 */

import type { ElectronApi } from '@/types/electron';
import type { DatabaseAdapter, DatabaseConfig, QueryResult } from './types';

/**
 * Convert snake_case to camelCase.
 */
function snakeToCamel(str: string): string {
  return str.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase());
}

/**
 * Map row object keys from snake_case to camelCase.
 * This is needed because SQLite returns column names in snake_case,
 * but Drizzle sqlite-proxy expects camelCase property names.
 */
function mapRowKeys(row: Record<string, unknown>): Record<string, unknown> {
  const mapped: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(row)) {
    mapped[snakeToCamel(key)] = value;
  }
  return mapped;
}

function getElectronApi(): ElectronApi {
  if (!window.electron?.sqlite) {
    throw new Error('Electron SQLite API not available');
  }
  return window.electron;
}

export class ElectronAdapter implements DatabaseAdapter {
  private initialized = false;
  private dbName = '';

  async initialize(config: DatabaseConfig): Promise<void> {
    const api = getElectronApi();

    await api.sqlite.initialize({
      name: config.name,
      encryptionKey: Array.from(config.encryptionKey)
    });

    this.dbName = config.name;
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

  async rekeyDatabase(newKey: Uint8Array, _oldKey?: Uint8Array): Promise<void> {
    const api = getElectronApi();
    await api.sqlite.rekey(Array.from(newKey));
  }

  getConnection(): unknown {
    // For Drizzle sqlite-proxy, return a function that always returns { rows: any[] }
    return async (
      sql: string,
      params: unknown[],
      _method: 'all' | 'get' | 'run' | 'values'
    ): Promise<{ rows: unknown[] }> => {
      const result = await this.execute(sql, params);

      // Drizzle sqlite-proxy expects { rows: any[] } for ALL methods
      // The method parameter tells Drizzle how to interpret the rows
      // Map column names from snake_case to camelCase for Drizzle schema compatibility
      const mappedRows = result.rows.map((row) =>
        mapRowKeys(row as Record<string, unknown>)
      );
      return { rows: mappedRows };
    };
  }

  async deleteDatabase(name: string): Promise<void> {
    const api = getElectronApi();
    await api.sqlite.deleteDatabase(name);
    this.initialized = false;
  }

  async exportDatabase(): Promise<Uint8Array> {
    if (!this.initialized || !this.dbName) {
      throw new Error('Database not initialized');
    }
    const api = getElectronApi();
    const data = await api.sqlite.export(this.dbName);
    return new Uint8Array(data);
  }

  async importDatabase(
    data: Uint8Array,
    encryptionKey?: Uint8Array
  ): Promise<void> {
    if (!this.dbName) {
      throw new Error('Database name not set');
    }
    if (!encryptionKey) {
      throw new Error('Electron adapter requires encryption key for import');
    }
    const api = getElectronApi();
    await api.sqlite.import(
      this.dbName,
      Array.from(data),
      Array.from(encryptionKey)
    );
  }
}
