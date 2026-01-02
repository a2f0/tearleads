/**
 * Node.js adapter for SQLite using better-sqlite3-multiple-ciphers.
 * Used for Vitest integration tests to provide real database I/O.
 *
 * This adapter requires Node.js 22.x to match Electron's bundled Node.js version,
 * ensuring the native module compiled by electron-rebuild is compatible.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3-multiple-ciphers';
import type { DatabaseAdapter, DatabaseConfig, QueryResult } from './types';
import { convertRowsToArrays } from './utils';

export interface NodeAdapterOptions {
  /**
   * Skip encryption (for testing without encryption overhead). Default: false.
   * Note: When encryption is enabled, temp files are used instead of :memory:
   * because SQLite3MultipleCiphers doesn't support encryption for in-memory databases.
   */
  skipEncryption?: boolean;
  /** Custom file path. If not provided, uses a temp file when encryption is enabled, or :memory: when disabled. */
  filePath?: string;
}

export class NodeAdapter implements DatabaseAdapter {
  private db: Database.Database | null = null;
  private dbPath = '';
  private options: NodeAdapterOptions;

  constructor(options: NodeAdapterOptions = {}) {
    this.options = {
      skipEncryption: false,
      ...options
    };
  }

  async initialize(config: DatabaseConfig): Promise<void> {
    if (this.db) {
      throw new Error('Database already initialized');
    }

    // SQLite3MultipleCiphers doesn't support encryption for :memory: databases.
    // Use temp files when encryption is enabled, :memory: when disabled.
    let filename: string;
    if (this.options.filePath) {
      filename = this.options.filePath;
    } else if (this.options.skipEncryption) {
      filename = ':memory:';
    } else {
      // Create a unique temp file for this test
      const timestamp = Date.now();
      const random = Math.random().toString(36).substring(7);
      filename = path.join(
        os.tmpdir(),
        `vitest-db-${config.name}-${timestamp}-${random}.db`
      );
    }

    this.dbPath = filename;
    this.db = new Database(filename);

    if (!this.options.skipEncryption) {
      // Set up encryption using SQLite3MultipleCiphers (same as Electron)
      // Use ChaCha20-Poly1305 cipher (recommended)
      this.db.pragma(`cipher='chacha20'`);

      const keyHex = Buffer.from(config.encryptionKey).toString('hex');
      this.db.pragma(`key="x'${keyHex}'"`);

      // Verify the key works by running a simple query
      try {
        this.db.exec('SELECT 1');
      } catch {
        this.db.close();
        this.db = null;
        throw new Error('Invalid encryption key');
      }
    }

    // Enable foreign keys
    this.db.pragma('foreign_keys = ON');
  }

  async close(): Promise<void> {
    if (this.db) {
      this.db.close();
      this.db = null;

      // Clean up temp files (those created by us when no filePath and encryption enabled)
      if (!this.options.filePath && !this.options.skipEncryption) {
        try {
          fs.rmSync(this.dbPath, { force: true });
          fs.rmSync(`${this.dbPath}-wal`, { force: true });
          fs.rmSync(`${this.dbPath}-shm`, { force: true });
        } catch {
          // Ignore cleanup errors
        }
      }
    }
  }

  isOpen(): boolean {
    return this.db !== null;
  }

  async execute(sql: string, params?: unknown[]): Promise<QueryResult> {
    if (!this.db) {
      throw new Error('Database not initialized');
    }

    const stmt = this.db.prepare(sql);
    const isSelect =
      sql.trim().toUpperCase().startsWith('SELECT') ||
      sql.trim().toUpperCase().startsWith('PRAGMA');

    if (isSelect) {
      const rows = params ? stmt.all(...params) : stmt.all();
      return { rows: rows as Record<string, unknown>[] };
    }

    const result = params ? stmt.run(...params) : stmt.run();
    return {
      rows: [],
      changes: result.changes,
      lastInsertRowId: Number(result.lastInsertRowid)
    };
  }

  async executeMany(statements: string[]): Promise<void> {
    if (!this.db) {
      throw new Error('Database not initialized');
    }

    const db = this.db;
    const runStatements = db.transaction((stmts: string[]) => {
      for (const sql of stmts) {
        db.exec(sql);
      }
    });

    runStatements(statements);
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

  async rekeyDatabase(newKey: Uint8Array, _oldKey?: Uint8Array): Promise<void> {
    if (!this.db) {
      throw new Error('Database not initialized');
    }

    if (this.options.skipEncryption) {
      // Can't rekey an unencrypted database
      return;
    }

    // For in-memory databases, we can rekey directly (no WAL)
    const keyHex = Buffer.from(newKey).toString('hex');
    this.db.pragma(`rekey="x'${keyHex}'"`);
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
      // convertRowsToArrays handles both explicit SELECT and SELECT * queries.
      const arrayRows = convertRowsToArrays(sql, result.rows);
      return { rows: arrayRows };
    };
  }

  async deleteDatabase(_name: string): Promise<void> {
    // For in-memory databases, just close and clear
    await this.close();
  }

  async exportDatabase(): Promise<Uint8Array> {
    if (!this.db) {
      throw new Error('Database not initialized');
    }

    // Use better-sqlite3's serialize() method for in-memory databases
    // This returns the raw database as a Buffer
    return this.db.serialize();
  }

  async importDatabase(
    data: Uint8Array,
    encryptionKey?: Uint8Array
  ): Promise<void> {
    // Close current database
    await this.close();

    // Create new database from the serialized data
    this.db = new Database(Buffer.from(data));

    if (!this.options.skipEncryption && encryptionKey) {
      const keyHex = Buffer.from(encryptionKey).toString('hex');
      this.db.pragma(`cipher='chacha20'`);
      this.db.pragma(`key="x'${keyHex}'"`);

      // Verify key works
      try {
        this.db.exec('SELECT 1');
      } catch {
        this.db.close();
        this.db = null;
        throw new Error(
          'Failed to open imported database: invalid encryption key'
        );
      }
    }

    this.db.pragma('foreign_keys = ON');
  }
}
