/**
 * WASM-based SQLite adapter for CLI.
 * Adapted from packages/client/src/db/adapters/wasm-node.adapter.ts
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isRecord } from '@rapid/shared';
import type {
  DatabaseAdapter,
  DatabaseConfig,
  JsonBackupData,
  QueryResult
} from './types.js';

declare global {
  // eslint-disable-next-line no-var
  var sqlite3InitModuleState:
    | { wasmFilename: string; debugModule: () => void }
    | undefined;
}

const originalFetch = globalThis.fetch;

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

function restoreFetch(): void {
  if (originalFetch) {
    globalThis.fetch = originalFetch;
  }
}

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

interface SQLiteOO1 {
  DB: new (options: {
    filename: string;
    flags: string;
    hexkey?: string;
  }) => SQLiteDatabase;
}

interface SQLiteCAPI {
  sqlite3_libversion(): string;
  sqlite3_js_db_export(db: SQLiteDatabase): Uint8Array;
}

interface SQLite3Module {
  oo1: SQLiteOO1;
  capi: SQLiteCAPI;
}

type SQLite3InitModule = (options: {
  print: typeof console.log;
  printErr: typeof console.error;
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
  if (!isRecord(value)) return false;
  if (typeof value['version'] !== 'number') return false;
  if (!Array.isArray(value['tables']) || !value['tables'].every(isNameSqlEntry))
    return false;
  if (
    !Array.isArray(value['indexes']) ||
    !value['indexes'].every(isNameSqlEntry)
  )
    return false;
  if (!isRecord(value['data'])) return false;
  for (const tableRows of Object.values(value['data'])) {
    if (!Array.isArray(tableRows)) return false;
    for (const row of tableRows) {
      if (!isRecord(row)) return false;
    }
  }
  return true;
}

function parseJsonBackupData(jsonData: string): JsonBackupData {
  const parsed = JSON.parse(jsonData) as unknown;
  if (!isJsonBackupData(parsed)) {
    throw new Error('Invalid backup data format');
  }
  return parsed;
}

let sqlite3: SQLite3Module | null = null;

function getWasmDir(): string {
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);
  return path.resolve(__dirname, '../wasm');
}

async function initializeSqliteWasm(): Promise<SQLite3Module> {
  if (sqlite3) {
    return sqlite3;
  }

  const wasmDir = getWasmDir();
  const modulePath = path.join(wasmDir, 'sqlite3.mjs');
  const wasmPath = path.join(wasmDir, 'sqlite3.wasm');

  if (!fs.existsSync(modulePath)) {
    throw new Error(
      `SQLite WASM module not found at ${modulePath}. ` +
        'Run pnpm --filter @rapid/cli build first.'
    );
  }
  if (!fs.existsSync(wasmPath)) {
    throw new Error(
      `SQLite WASM binary not found at ${wasmPath}. ` +
        'Run pnpm --filter @rapid/cli build first.'
    );
  }

  patchFetchForFileUrls();

  try {
    globalThis.sqlite3InitModuleState = {
      wasmFilename: 'sqlite3.wasm',
      debugModule: () => {}
    };

    const wasmModule = (await import(modulePath)) as { default?: unknown };
    const initModule = wasmModule.default as SQLite3InitModule | undefined;

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

function keyToHex(key: Uint8Array): string {
  return Array.from(key)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

export class WasmNodeAdapter implements DatabaseAdapter {
  private db: SQLiteDatabase | null = null;
  private encryptionKey: string | null = null;

  async initialize(config: DatabaseConfig): Promise<void> {
    if (this.db) {
      throw new Error('Database already initialized');
    }

    const sqlite = await initializeSqliteWasm();
    this.encryptionKey = keyToHex(config.encryptionKey);

    const filename = `${config.name}-${Date.now()}-${Math.random().toString(36).slice(2)}.sqlite3`;

    try {
      this.db = new sqlite.oo1.DB({
        filename,
        flags: 'c',
        hexkey: this.encryptionKey
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

  async rekeyDatabase(newKey: Uint8Array): Promise<void> {
    if (!this.db) {
      throw new Error('Database not initialized');
    }

    const newHexKey = keyToHex(newKey);
    this.db.exec('PRAGMA wal_checkpoint(TRUNCATE);');
    this.db.exec(`PRAGMA hexrekey = '${newHexKey}';`);
    this.encryptionKey = newHexKey;
  }

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

  async importDatabaseFromJson(
    jsonData: string,
    encryptionKey?: Uint8Array
  ): Promise<void> {
    await this.close();

    const sqlite = await initializeSqliteWasm();

    if (encryptionKey) {
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
          // Ignore
        }
        this.db = null;
      }
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to import database from JSON: ${message}`);
    }
  }
}
