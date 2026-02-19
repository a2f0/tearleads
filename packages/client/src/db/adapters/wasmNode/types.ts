/**
 * Types for WASM SQLite adapter.
 */

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

/**
 * JSON backup format for WASM SQLite databases.
 */
export type JsonBackupData = {
  version: number;
  tables: { name: string; sql: string }[];
  indexes: { name: string; sql: string }[];
  data: Record<string, Record<string, unknown>[]>;
};

export interface WasmNodeAdapterOptions {
  /**
   * Skip encryption (for testing without encryption overhead). Default: false.
   */
  skipEncryption?: boolean;
}
