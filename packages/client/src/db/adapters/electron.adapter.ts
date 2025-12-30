/**
 * Electron adapter for SQLite using better-sqlite3-multiple-ciphers.
 * Communicates with the main process via IPC.
 */

import type { ElectronApi } from '@/types/electron';
import type { DatabaseAdapter, DatabaseConfig, QueryResult } from './types';

/**
 * Extract column names from a SELECT statement.
 * Returns column names in the order they appear in the SELECT clause.
 */
function extractSelectColumns(sql: string): string[] | null {
  const selectMatch = sql.match(/select\s+(.+?)\s+from\s/is);
  if (!selectMatch || !selectMatch[1]) return null;

  const selectClause = selectMatch[1];
  if (selectClause.trim() === '*') return null;

  const columns: string[] = [];
  let depth = 0;
  let current = '';

  for (const char of selectClause) {
    if (char === '(') depth++;
    else if (char === ')') depth--;
    else if (char === ',' && depth === 0) {
      columns.push(current.trim());
      current = '';
      continue;
    }
    current += char;
  }
  if (current.trim()) {
    columns.push(current.trim());
  }

  return columns.map((col) => {
    const quotedMatches = col.match(/"([^"]+)"/g);
    if (quotedMatches && quotedMatches.length > 0) {
      const lastMatch = quotedMatches[quotedMatches.length - 1];
      return lastMatch?.replace(/"/g, '') ?? col;
    }
    return col;
  });
}

/**
 * Convert a row object to an array of values in the column order specified.
 */
function rowToArray(
  row: Record<string, unknown>,
  columns: string[]
): unknown[] {
  return columns.map((col) => row[col]);
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
    // IMPORTANT: Drizzle sqlite-proxy expects rows as ARRAYS of values, not objects.
    // The values must be in the same order as columns in the SELECT clause.
    return async (
      sql: string,
      params: unknown[],
      _method: 'all' | 'get' | 'run' | 'values'
    ): Promise<{ rows: unknown[] }> => {
      const result = await this.execute(sql, params);

      // Drizzle sqlite-proxy expects { rows: any[] } for ALL methods
      // The rows must be ARRAYS of values in SELECT column order, not objects.
      const columns = extractSelectColumns(sql);

      if (columns && result.rows.length > 0) {
        const arrayRows = result.rows.map((row) =>
          rowToArray(row as Record<string, unknown>, columns)
        );
        return { rows: arrayRows };
      }

      return { rows: result.rows };
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
