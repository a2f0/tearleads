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
import { locateWasmDir } from '../locateWasm.js';
import type {
  DatabaseAdapter,
  DatabaseConfig,
  DrizzleConnection,
  QueryResult
} from './types.js';
import { convertRowsToArrays } from './utils.js';
import {
  getStringField,
  isJsonBackupData,
  isNameSqlEntry,
  type JsonBackupData,
  keyToHex,
  parseJsonBackupData,
  type SQLite3InitModule,
  type SQLite3Module,
  type SQLiteDatabase,
  type WasmNodeAdapterOptions
} from './wasmNodeTypes.js';

export type {
  JsonBackupData,
  WasmNodeAdapterOptions
} from './wasmNodeTypes.js';

declare global {
  var sqlite3InitModuleState:
    | { wasmFilename: string; debugModule: () => void }
    | undefined;
}

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

    if (url.startsWith('file://')) {
      const filePath = fileURLToPath(url);
      const buffer = fs.readFileSync(filePath);
      return new Response(buffer, {
        status: 200,
        statusText: 'OK',
        headers: { 'Content-Type': 'application/wasm' }
      });
    }

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

let sqlite3: SQLite3Module | null = null;
let cachedWasmDir: string | null = null;

/**
 * Get the path to the WASM files directory.
 * Uses the configured wasmDir or locates it in the monorepo.
 */
function getWasmDir(configuredDir?: string): string {
  if (configuredDir) {
    return configuredDir;
  }

  if (cachedWasmDir) {
    return cachedWasmDir;
  }

  cachedWasmDir = locateWasmDir();
  return cachedWasmDir;
}

/**
 * Initialize the SQLite WASM module for Node.js.
 * This only needs to run once per process.
 */
async function initializeSqliteWasm(wasmDir?: string): Promise<SQLite3Module> {
  if (sqlite3) {
    return sqlite3;
  }

  const resolvedWasmDir = getWasmDir(wasmDir);
  const modulePath = path.join(resolvedWasmDir, 'sqlite3.js');
  const wasmPath = path.join(resolvedWasmDir, 'sqlite3.wasm');

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

  patchFetchForFileUrls();

  try {
    globalThis.sqlite3InitModuleState = {
      wasmFilename: 'sqlite3.wasm',
      debugModule: () => {}
    };

    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    const wasmModule = await import(/* @vite-ignore */ modulePath);
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access
    const initModule: SQLite3InitModule | undefined = wasmModule.default;

    if (!initModule) {
      throw new Error('Failed to load sqlite3InitModule from module');
    }

    sqlite3 = await initModule({
      print: console.log,
      printErr: console.error
    });

    if (!sqlite3 || !sqlite3.oo1 || !sqlite3.capi) {
      throw new Error('SQLite module loaded but missing expected properties');
    }

    return sqlite3;
  } finally {
    restoreFetch();
  }
}

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

    const sqlite = await initializeSqliteWasm(this.options.wasmDir);

    if (!this.options.skipEncryption) {
      this.encryptionKey = keyToHex(config.encryptionKey);
    }

    const filename = `${config.name}-${Date.now()}-${Math.random().toString(36).slice(2)}.sqlite3`;

    try {
      this.db = new sqlite.oo1.DB({
        filename,
        flags: 'c',
        ...(this.encryptionKey ? { hexkey: this.encryptionKey } : {})
      });

      this.db.exec('SELECT 1;');
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
      const rows: Record<string, unknown>[] = [];

      this.db.exec({
        sql,
        ...(params ? { bind: params } : {}),
        rowMode: 'object',
        callback: (row: Record<string, unknown>) => {
          rows.push(row);
          return undefined;
        }
      });

      return { rows };
    }

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
      return;
    }

    const newHexKey = keyToHex(newKey);

    this.db.exec('PRAGMA wal_checkpoint(TRUNCATE);');
    this.db.exec(`PRAGMA hexrekey = '${newHexKey}';`);

    this.encryptionKey = newHexKey;
  }

  getConnection(): DrizzleConnection {
    return async (
      sql: string,
      params: unknown[],
      _method: 'all' | 'get' | 'run' | 'values'
    ): Promise<{ rows: unknown[] }> => {
      const result = await this.execute(sql, params);
      const arrayRows = convertRowsToArrays(sql, result.rows);
      return { rows: arrayRows };
    };
  }

  async deleteDatabase(_name: string): Promise<void> {
    await this.close();
  }

  async exportDatabase(): Promise<Uint8Array> {
    if (!this.db) {
      throw new Error('Database not initialized');
    }

    const sqlite = await initializeSqliteWasm(this.options.wasmDir);
    return sqlite.capi.sqlite3_js_db_export(this.db);
  }

  /**
   * Export the database as a JSON string containing schema and data.
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
   */
  async importDatabaseFromJson(
    jsonData: string,
    encryptionKey?: Uint8Array
  ): Promise<void> {
    await this.close();

    const sqlite = await initializeSqliteWasm(this.options.wasmDir);

    if (!this.options.skipEncryption && encryptionKey) {
      this.encryptionKey = keyToHex(encryptionKey);
    }

    const filename = `import-${Date.now()}-${Math.random().toString(36).slice(2)}.sqlite3`;

    try {
      const data = parseJsonBackupData(jsonData);

      if (data.version !== 1) {
        throw new Error(`Unsupported backup version: ${data.version}`);
      }

      this.db = new sqlite.oo1.DB({
        filename,
        flags: 'c',
        ...(this.encryptionKey ? { hexkey: this.encryptionKey } : {})
      });

      this.db.exec('BEGIN TRANSACTION;');
      try {
        for (const table of data.tables) {
          if (table.sql) {
            this.db.exec(table.sql);
          }
        }

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
    const textDecoder = new TextDecoder();
    const firstChars = textDecoder.decode(data.slice(0, 20));

    if (firstChars.startsWith('{"version":')) {
      const jsonStr = textDecoder.decode(data);
      return this.importDatabaseFromJson(jsonStr, encryptionKey);
    }

    throw new Error(
      'Binary SQLite database import is not supported with SQLite3MultipleCiphers WASM. ' +
        'The sqlite3_deserialize function does not work with this build. ' +
        'Use exportDatabaseAsJson/importDatabaseFromJson for backup/restore functionality.'
    );
  }
}

export const __test__ = {
  getStringField,
  initializeSqliteWasm,
  isJsonBackupData,
  isNameSqlEntry,
  keyToHex,
  parseJsonBackupData,
  patchFetchForFileUrls,
  restoreFetch
};
