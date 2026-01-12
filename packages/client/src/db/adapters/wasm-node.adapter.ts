/**
 * WASM-based SQLite adapter for Node.js/Vitest integration tests.
 *
 * This adapter uses the same SQLite WASM module (with SQLite3MultipleCiphers
 * encryption) as the web app, avoiding the need for native module compilation.
 * It runs SQLite WASM directly in Node.js without Web Workers.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isRecord } from '@rapid/shared';
import type { DatabaseAdapter, DatabaseConfig, QueryResult } from './types';
import { convertRowsToArrays } from './utils';

declare global {
  var sqlite3InitModuleState:
    | { wasmFilename: string; debugModule: () => void }
    | undefined;
}

// Store original fetch to restore later
const originalFetch = globalThis.fetch;

/**
 * Polyfill fetch for file:// URLs in Node.js.
 * The SQLite WASM module uses fetch to load the .wasm file, which doesn't work
 * with file:// URLs in Node.js. This polyfill handles that case.
 */
function patchFetchForFileUrls(): void {
  globalThis.fetch = async (
    input: RequestInfo | URL,
    init?: RequestInit
  ): Promise<Response> => {
    const url = typeof input === 'string' ? input : input.toString();

    // Handle file:// URLs by reading from filesystem
    if (url.startsWith('file://')) {
      const filePath = fileURLToPath(url);
      const buffer = fs.readFileSync(filePath);
      return new Response(buffer, {
        status: 200,
        statusText: 'OK',
        headers: { 'Content-Type': 'application/wasm' }
      });
    }

    // Fall back to original fetch for other URLs
    return originalFetch(input, init);
  };
}

/**
 * Restore the original fetch function.
 */
function restoreFetch(): void {
  if (originalFetch) {
    globalThis.fetch = originalFetch;
  }
}

/**
 * SQLite WASM Database instance type.
 */
interface SQLiteDatabase {
  exec(options: {
    sql: string;
    bind?: unknown[];
    rowMode?: 'object' | 'array';
    callback?: (row: Record<string, unknown>) => boolean | undefined;
    returnValue?: 'resultRows';
  }): unknown[][];
  exec(sql: string): void;
  changes(): number;
  close(): void;
  pointer: number;
}

/**
 * SQLite WASM OO1 API (Object-Oriented API Level 1).
 */
interface SQLiteOO1 {
  DB: new (options: {
    filename: string;
    flags: string;
    hexkey?: string;
  }) => SQLiteDatabase;
}

/**
 * SQLite WASM C API bindings.
 */
interface SQLiteCAPI {
  sqlite3_libversion(): string;
  sqlite3_js_db_export(db: SQLiteDatabase): Uint8Array;
  sqlite3_deserialize(
    dbPointer: number,
    schema: string,
    data: Uint8Array,
    dataSize: number,
    bufferSize: number,
    flags: number
  ): number;
}

/**
 * SQLite WASM module instance.
 */
interface SQLite3Module {
  oo1: SQLiteOO1;
  capi: SQLiteCAPI;
}

/**
 * SQLite WASM initialization function type.
 */
type SQLite3InitModule = (options: {
  print: typeof console.log;
  printErr: typeof console.error;
  locateFile?: (path: string) => string;
  wasmBinary?: ArrayBuffer;
}) => Promise<SQLite3Module>;

function getStringField(
  record: Record<string, unknown>,
  key: string
): string | null {
  const value = record[key];
  return typeof value === 'string' ? value : null;
}

function isNameSqlEntry(
  value: unknown
): value is { name: string; sql: string } {
  return (
    isRecord(value) &&
    typeof value['name'] === 'string' &&
    typeof value['sql'] === 'string'
  );
}

function isJsonBackupData(value: unknown): value is JsonBackupData {
  if (!isRecord(value)) {
    return false;
  }

  if (typeof value['version'] !== 'number') {
    return false;
  }

  if (
    !Array.isArray(value['tables']) ||
    !value['tables'].every(isNameSqlEntry) ||
    !Array.isArray(value['indexes']) ||
    !value['indexes'].every(isNameSqlEntry)
  ) {
    return false;
  }

  if (!isRecord(value['data'])) {
    return false;
  }

  for (const tableRows of Object.values(value['data'])) {
    if (!Array.isArray(tableRows)) {
      return false;
    }
    for (const row of tableRows) {
      if (!isRecord(row)) {
        return false;
      }
    }
  }

  return true;
}

function parseJsonBackupData(jsonData: string): JsonBackupData {
  const parsed = JSON.parse(jsonData);
  if (!isJsonBackupData(parsed)) {
    throw new Error('Invalid backup data format');
  }
  return parsed;
}

// Module-level state for caching the initialized SQLite module
let sqlite3: SQLite3Module | null = null;

/**
 * Get the path to the WASM files directory.
 */
function getWasmDir(): string {
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);
  return path.resolve(__dirname, '../../workers/sqlite-wasm');
}

/**
 * Initialize the SQLite WASM module for Node.js.
 * This only needs to run once per process.
 */
async function initializeSqliteWasm(): Promise<SQLite3Module> {
  if (sqlite3) {
    return sqlite3;
  }

  const wasmDir = getWasmDir();
  // Note: Using .js extension instead of .mjs for Android WebView MIME type compatibility
  const modulePath = path.join(wasmDir, 'sqlite3.js');
  const wasmPath = path.join(wasmDir, 'sqlite3.wasm');

  // Verify the files exist
  if (!fs.existsSync(modulePath)) {
    throw new Error(
      `SQLite WASM module not found at ${modulePath}. ` +
        'Run ./scripts/downloadSqliteWasm.sh to download it.'
    );
  }
  if (!fs.existsSync(wasmPath)) {
    throw new Error(
      `SQLite WASM binary not found at ${wasmPath}. ` +
        'Run ./scripts/downloadSqliteWasm.sh to download it.'
    );
  }

  // Patch fetch to handle file:// URLs before importing the module
  // The sqlite3 module uses fetch internally to load the .wasm file
  patchFetchForFileUrls();

  try {
    // Set up globalThis.sqlite3InitModuleState BEFORE importing the module
    // The module reads this during import to configure instantiateWasm
    globalThis.sqlite3InitModuleState = {
      wasmFilename: 'sqlite3.wasm',
      debugModule: () => {}
    };

    // Import the WASM module
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    const wasmModule = await import(/* @vite-ignore */ modulePath);
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access
    const initModule: SQLite3InitModule | undefined = wasmModule.default;

    if (!initModule) {
      throw new Error('Failed to load sqlite3InitModule from module');
    }

    // Initialize with Node.js-compatible settings
    sqlite3 = await initModule({
      print: console.log,
      printErr: console.error
    });

    if (!sqlite3 || !sqlite3.oo1 || !sqlite3.capi) {
      throw new Error('SQLite module loaded but missing expected properties');
    }

    return sqlite3;
  } finally {
    // Restore original fetch
    restoreFetch();
  }
}

/**
 * Convert a Uint8Array encryption key to a hex string for SQLite.
 */
function keyToHex(key: Uint8Array): string {
  return Array.from(key)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

export interface WasmNodeAdapterOptions {
  /**
   * Skip encryption (for testing without encryption overhead). Default: false.
   */
  skipEncryption?: boolean;
}

/**
 * JSON backup format for WASM SQLite databases.
 * Used by exportDatabaseAsJson/importDatabaseFromJson.
 */
export type JsonBackupData = {
  version: number;
  tables: { name: string; sql: string }[];
  indexes: { name: string; sql: string }[];
  data: Record<string, Record<string, unknown>[]>;
};

export class WasmNodeAdapter implements DatabaseAdapter {
  private db: SQLiteDatabase | null = null;
  private encryptionKey: string | null = null;
  private options: WasmNodeAdapterOptions;

  constructor(options: WasmNodeAdapterOptions = {}) {
    this.options = {
      skipEncryption: false,
      ...options
    };
  }

  async initialize(config: DatabaseConfig): Promise<void> {
    if (this.db) {
      throw new Error('Database already initialized');
    }

    // Initialize the WASM module
    const sqlite = await initializeSqliteWasm();

    // Convert key to hex format for SQLite encryption
    if (!this.options.skipEncryption) {
      this.encryptionKey = keyToHex(config.encryptionKey);
    }

    // Use unique filename for each adapter instance
    // SQLite3MultipleCiphers requires a file (not :memory:) for encryption
    // Using a unique name per instance ensures test isolation
    const filename = `${config.name}-${Date.now()}-${Math.random().toString(36).slice(2)}.sqlite3`;

    try {
      // Create/open encrypted database
      this.db = new sqlite.oo1.DB({
        filename,
        flags: 'c', // Create if not exists
        ...(this.encryptionKey ? { hexkey: this.encryptionKey } : {})
      });

      // Verify encryption is working
      this.db.exec('SELECT 1;');

      // Enable foreign keys
      this.db.exec('PRAGMA foreign_keys = ON;');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to open encrypted database: ${message}`);
    }
  }

  async close(): Promise<void> {
    if (this.db) {
      this.db.close();
      this.db = null;
      this.encryptionKey = null;
    }
  }

  isOpen(): boolean {
    return this.db !== null;
  }

  async execute(sql: string, params?: unknown[]): Promise<QueryResult> {
    if (!this.db) {
      throw new Error('Database not initialized');
    }

    const isSelect =
      sql.trim().toUpperCase().startsWith('SELECT') ||
      sql.trim().toUpperCase().startsWith('PRAGMA');

    if (isSelect) {
      // Execute and collect results
      const rows: Record<string, unknown>[] = [];

      this.db.exec({
        sql,
        ...(params ? { bind: params } : {}),
        rowMode: 'object',
        callback: (row: Record<string, unknown>) => {
          rows.push(row);
          return undefined; // Continue iterating
        }
      });

      return { rows };
    }

    // Non-SELECT: execute without returning rows
    this.db.exec({
      sql,
      ...(params ? { bind: params } : {})
    });

    const lastInsertRowId = Number(
      this.db.exec({
        sql: 'SELECT last_insert_rowid()',
        returnValue: 'resultRows'
      })[0]?.[0] ?? 0
    );

    return {
      rows: [],
      changes: this.db.changes(),
      lastInsertRowId
    };
  }

  async executeMany(statements: string[]): Promise<void> {
    if (!this.db) {
      throw new Error('Database not initialized');
    }

    // Execute statements in a transaction for atomicity
    this.db.exec('BEGIN TRANSACTION;');
    try {
      for (const sql of statements) {
        this.db.exec(sql);
      }
      this.db.exec('COMMIT;');
    } catch (error) {
      this.db.exec('ROLLBACK;');
      throw error;
    }
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

    const newHexKey = keyToHex(newKey);

    // Checkpoint WAL data before rekey
    this.db.exec('PRAGMA wal_checkpoint(TRUNCATE);');

    // Use PRAGMA hexrekey for hex-encoded keys
    this.db.exec(`PRAGMA hexrekey = '${newHexKey}';`);

    this.encryptionKey = newHexKey;
  }

  getConnection(): unknown {
    // For Drizzle sqlite-proxy, return a function that always returns { rows: any[] }
    // IMPORTANT: Drizzle sqlite-proxy expects rows as ARRAYS of values, not objects.
    return async (
      sql: string,
      params: unknown[],
      _method: 'all' | 'get' | 'run' | 'values'
    ): Promise<{ rows: unknown[] }> => {
      const result = await this.execute(sql, params);

      // Drizzle sqlite-proxy expects { rows: any[] } for ALL methods
      // The rows must be ARRAYS of values in SELECT column order, not objects.
      const arrayRows = convertRowsToArrays(sql, result.rows);
      return { rows: arrayRows };
    };
  }

  async deleteDatabase(_name: string): Promise<void> {
    // For in-memory databases, just close
    await this.close();
  }

  async exportDatabase(): Promise<Uint8Array> {
    if (!this.db) {
      throw new Error('Database not initialized');
    }

    const sqlite = await initializeSqliteWasm();
    return sqlite.capi.sqlite3_js_db_export(this.db);
  }

  /**
   * Export the database as a JSON string containing schema and data.
   *
   * This is an alternative to exportDatabase() that works around the
   * sqlite3_deserialize limitation in SQLite3MultipleCiphers WASM.
   *
   * The format is: { version: 1, tables: [...], indexes: [...], data: {...} }
   */
  async exportDatabaseAsJson(): Promise<string> {
    if (!this.db) {
      throw new Error('Database not initialized');
    }

    const result: JsonBackupData = {
      version: 1,
      tables: [],
      indexes: [],
      data: {}
    };

    // Export table schemas
    this.db.exec({
      sql: "SELECT name, sql FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
      rowMode: 'object',
      callback: (row: Record<string, unknown>) => {
        const name = getStringField(row, 'name');
        const sql = getStringField(row, 'sql');
        if (name && sql) {
          result.tables.push({ name, sql });
        }
        return undefined;
      }
    });

    // Export index schemas
    this.db.exec({
      sql: "SELECT name, sql FROM sqlite_master WHERE type='index' AND sql IS NOT NULL ORDER BY name",
      rowMode: 'object',
      callback: (row: Record<string, unknown>) => {
        const name = getStringField(row, 'name');
        const sql = getStringField(row, 'sql');
        if (name && sql) {
          result.indexes.push({ name, sql });
        }
        return undefined;
      }
    });

    // Export data from each table
    for (const table of result.tables) {
      const rows: Record<string, unknown>[] = [];
      this.db.exec({
        sql: `SELECT * FROM "${table.name}"`,
        rowMode: 'object',
        callback: (row: Record<string, unknown>) => {
          rows.push(row);
          return undefined;
        }
      });
      result.data[table.name] = rows;
    }

    return JSON.stringify(result);
  }

  /**
   * Import a database from a JSON string (from exportDatabaseAsJson).
   *
   * This method closes the current database and creates a new one with the
   * imported schema and data.
   */
  async importDatabaseFromJson(
    jsonData: string,
    encryptionKey?: Uint8Array
  ): Promise<void> {
    // Close current database
    await this.close();

    const sqlite = await initializeSqliteWasm();

    // Determine the encryption key to use
    if (!this.options.skipEncryption && encryptionKey) {
      this.encryptionKey = keyToHex(encryptionKey);
    }

    const filename = `import-${Date.now()}-${Math.random().toString(36).slice(2)}.sqlite3`;

    try {
      const data = parseJsonBackupData(jsonData);

      if (data.version !== 1) {
        throw new Error(`Unsupported backup version: ${data.version}`);
      }

      // Create new database with encryption
      this.db = new sqlite.oo1.DB({
        filename,
        flags: 'c',
        ...(this.encryptionKey ? { hexkey: this.encryptionKey } : {})
      });

      // Wrap all schema/data operations in a transaction for atomicity and performance
      this.db.exec('BEGIN TRANSACTION;');
      try {
        // Create tables
        for (const table of data.tables) {
          if (table.sql) {
            this.db.exec(table.sql);
          }
        }

        // Insert data
        for (const [tableName, rows] of Object.entries(data.data)) {
          for (const row of rows) {
            const columns = Object.keys(row);
            if (columns.length === 0) continue;

            const placeholders = columns.map(() => '?').join(', ');
            const values = columns.map((col) => row[col]);

            this.db.exec({
              sql: `INSERT INTO "${tableName}" (${columns.map((c) => `"${c}"`).join(', ')}) VALUES (${placeholders})`,
              bind: values
            });
          }
        }

        // Create indexes
        for (const index of data.indexes) {
          if (index.sql) {
            this.db.exec(index.sql);
          }
        }

        this.db.exec('COMMIT;');
      } catch (txError) {
        this.db.exec('ROLLBACK;');
        throw txError;
      }

      // Enable foreign keys
      this.db.exec('PRAGMA foreign_keys = ON;');
    } catch (error) {
      if (this.db) {
        try {
          this.db.close();
        } catch {
          // Ignore close error
        }
        this.db = null;
      }
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to import database from JSON: ${message}`);
    }
  }

  async importDatabase(
    data: Uint8Array,
    encryptionKey?: Uint8Array
  ): Promise<void> {
    // IMPORTANT: sqlite3_js_db_export returns UNENCRYPTED data (serialized in-memory pages).
    // However, sqlite3_deserialize does NOT work with SQLite3MultipleCiphers WASM
    // (returns SQLITE_NOTADB error).
    //
    // WORKAROUND: Check if the data is our JSON format first (for compatibility with
    // exportDatabaseAsJson). If it's a binary SQLite file, we currently cannot import it.
    //
    // For proper backup/restore support, use exportDatabaseAsJson/importDatabaseFromJson instead.

    // Try to detect if this is JSON data
    const textDecoder = new TextDecoder();
    const firstChars = textDecoder.decode(data.slice(0, 20));

    if (firstChars.startsWith('{"version":')) {
      // This is our JSON backup format
      const jsonStr = textDecoder.decode(data);
      return this.importDatabaseFromJson(jsonStr, encryptionKey);
    }

    // Binary SQLite format - currently not supported due to sqlite3_deserialize limitations
    throw new Error(
      'Binary SQLite database import is not supported with SQLite3MultipleCiphers WASM. ' +
        'The sqlite3_deserialize function does not work with this build. ' +
        'Use exportDatabaseAsJson/importDatabaseFromJson for backup/restore functionality.'
    );
  }
}
