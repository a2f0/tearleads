/**
 * Types and interfaces for WASM Node SQLite adapter.
 */

import { isRecord } from '@tearleads/shared';

/**
 * SQLite WASM Database instance type.
 */
export interface SQLiteDatabase {
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
export interface SQLiteOO1 {
  DB: new (options: {
    filename: string;
    flags: string;
    hexkey?: string;
  }) => SQLiteDatabase;
}

/**
 * SQLite WASM C API bindings.
 */
export interface SQLiteCAPI {
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
export interface SQLite3Module {
  oo1: SQLiteOO1;
  capi: SQLiteCAPI;
}

/**
 * SQLite WASM initialization function type.
 */
export type SQLite3InitModule = (options: {
  print: typeof console.log;
  printErr: typeof console.error;
  locateFile?: (path: string) => string;
  wasmBinary?: ArrayBuffer;
}) => Promise<SQLite3Module>;

export interface WasmNodeAdapterOptions {
  /**
   * Skip encryption (for testing without encryption overhead). Default: false.
   */
  skipEncryption?: boolean | undefined;

  /**
   * Path to the directory containing SQLite WASM files.
   * If not specified, the adapter will search for them in the monorepo.
   */
  wasmDir?: string | undefined;
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

export function getStringField(
  record: Record<string, unknown>,
  key: string
): string | null {
  const value = record[key];
  return typeof value === 'string' ? value : null;
}

export function isNameSqlEntry(
  value: unknown
): value is { name: string; sql: string } {
  return (
    isRecord(value) &&
    typeof value['name'] === 'string' &&
    typeof value['sql'] === 'string'
  );
}

export function isJsonBackupData(value: unknown): value is JsonBackupData {
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

export function parseJsonBackupData(jsonData: string): JsonBackupData {
  const parsed = JSON.parse(jsonData);
  if (!isJsonBackupData(parsed)) {
    throw new Error('Invalid backup data format');
  }
  return parsed;
}

/**
 * Convert a Uint8Array encryption key to a hex string for SQLite.
 */
export function keyToHex(key: Uint8Array): string {
  return Array.from(key)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}
