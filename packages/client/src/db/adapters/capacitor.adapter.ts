/**
 * Capacitor adapter for SQLite using @capacitor-community/sqlite.
 * Uses SQLCipher for encryption on iOS and Android.
 */

import type { DatabaseAdapter, DatabaseConfig, QueryResult } from './types';

// Dynamic import types for Capacitor SQLite plugin
interface CapacitorSQLitePlugin {
  createConnection(options: {
    database: string;
    encrypted: boolean;
    mode: string;
    version: number;
    readonly: boolean;
  }): Promise<{ changes?: { changes: number; lastId: number } }>;
  closeConnection(options: {
    database: string;
    readonly: boolean;
  }): Promise<void>;
  open(options: { database: string; readonly: boolean }): Promise<void>;
  close(options: { database: string; readonly: boolean }): Promise<void>;
  execute(options: {
    database: string;
    statements: string;
    transaction?: boolean;
    readonly: boolean;
  }): Promise<{ changes?: { changes: number; lastId: number } }>;
  query(options: {
    database: string;
    statement: string;
    values?: unknown[];
    readonly: boolean;
  }): Promise<{ values?: Record<string, unknown>[] }>;
  run(options: {
    database: string;
    statement: string;
    values?: unknown[];
    transaction?: boolean;
    readonly: boolean;
  }): Promise<{ changes?: { changes: number; lastId: number } }>;
  isDBOpen(options: {
    database: string;
    readonly: boolean;
  }): Promise<{ result: boolean }>;
  executeSet(options: {
    database: string;
    set: Array<{ statement: string; values?: unknown[] }>;
    transaction?: boolean;
    readonly: boolean;
  }): Promise<{ changes?: { changes: number; lastId: number } }>;
}

let sqlite: CapacitorSQLitePlugin | null = null;

async function getPlugin(): Promise<CapacitorSQLitePlugin> {
  if (sqlite) return sqlite;

  const { CapacitorSQLite } = await import('@capacitor-community/sqlite');
  sqlite = CapacitorSQLite as unknown as CapacitorSQLitePlugin;
  return sqlite;
}

export class CapacitorAdapter implements DatabaseAdapter {
  private dbName: string | null = null;
  private isInitialized = false;

  async initialize(config: DatabaseConfig): Promise<void> {
    this.dbName = config.name;

    const plugin = await getPlugin();

    // Create connection with encryption enabled
    await plugin.createConnection({
      database: config.name,
      encrypted: true,
      mode: 'encryption',
      version: 1,
      readonly: false
    });

    // Set the encryption key
    // The key needs to be passed as a hex string for SQLCipher
    const keyHex = Array.from(config.encryptionKey)
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');

    // Open the database
    await plugin.open({
      database: config.name,
      readonly: false
    });

    // Set the encryption key via PRAGMA
    await plugin.execute({
      database: config.name,
      statements: `PRAGMA key = "x'${keyHex}'"`,
      transaction: false,
      readonly: false
    });

    // Enable WAL mode
    await plugin.execute({
      database: config.name,
      statements: 'PRAGMA journal_mode = WAL',
      transaction: false,
      readonly: false
    });

    // Enable foreign keys
    await plugin.execute({
      database: config.name,
      statements: 'PRAGMA foreign_keys = ON',
      transaction: false,
      readonly: false
    });

    this.isInitialized = true;
  }

  async close(): Promise<void> {
    if (this.dbName && this.isInitialized) {
      const plugin = await getPlugin();

      await plugin.close({
        database: this.dbName,
        readonly: false
      });

      await plugin.closeConnection({
        database: this.dbName,
        readonly: false
      });

      this.isInitialized = false;
    }
    this.dbName = null;
  }

  isOpen(): boolean {
    return this.isInitialized;
  }

  async execute(sql: string, params?: unknown[]): Promise<QueryResult> {
    if (!this.dbName || !this.isInitialized) {
      throw new Error('Database not initialized');
    }

    const plugin = await getPlugin();

    // Determine if this is a SELECT query
    const isSelect =
      sql.trim().toUpperCase().startsWith('SELECT') ||
      sql.trim().toUpperCase().startsWith('PRAGMA');

    if (isSelect) {
      const queryOpts: {
        database: string;
        statement: string;
        values?: unknown[];
        readonly: boolean;
      } = {
        database: this.dbName,
        statement: sql,
        readonly: false
      };
      if (params && params.length > 0) {
        queryOpts.values = params;
      }
      const result = await plugin.query(queryOpts);

      return {
        rows: result.values ?? []
      };
    }

    const runOpts: {
      database: string;
      statement: string;
      values?: unknown[];
      transaction?: boolean;
      readonly: boolean;
    } = {
      database: this.dbName,
      statement: sql,
      transaction: false,
      readonly: false
    };
    if (params && params.length > 0) {
      runOpts.values = params;
    }
    const result = await plugin.run(runOpts);

    const queryResult: QueryResult = {
      rows: []
    };
    if (result.changes?.changes !== undefined) {
      queryResult.changes = result.changes.changes;
    }
    if (result.changes?.lastId !== undefined) {
      queryResult.lastInsertRowId = result.changes.lastId;
    }
    return queryResult;
  }

  async executeMany(statements: string[]): Promise<void> {
    if (!this.dbName || !this.isInitialized) {
      throw new Error('Database not initialized');
    }

    const plugin = await getPlugin();

    await plugin.executeSet({
      database: this.dbName,
      set: statements.map((statement) => ({ statement })),
      transaction: true,
      readonly: false
    });
  }

  async beginTransaction(): Promise<void> {
    await this.execute('BEGIN TRANSACTION');
  }

  async commitTransaction(): Promise<void> {
    await this.execute('COMMIT');
  }

  async rollbackTransaction(): Promise<void> {
    await this.execute('ROLLBACK');
  }

  async rekeyDatabase(newKey: Uint8Array): Promise<void> {
    if (!this.dbName || !this.isInitialized) {
      throw new Error('Database not initialized');
    }

    const keyHex = Array.from(newKey)
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');

    const plugin = await getPlugin();

    await plugin.execute({
      database: this.dbName,
      statements: `PRAGMA rekey = "x'${keyHex}'"`,
      transaction: false,
      readonly: false
    });
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
}
