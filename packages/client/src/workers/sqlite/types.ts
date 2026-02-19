/**
 * Internal types for SQLite WASM worker.
 */

/**
 * SQLite WASM Database instance type.
 * Represents an open database connection.
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
  sqlite3_js_vfs_list(): string[];
  sqlite3mc_vfs_create(zVfsReal: string, makeDefault: number): number;
  SQLITE_OK: number;
  sqlite3_deserialize(
    dbPointer: number,
    schema: string,
    data: Uint8Array,
    dataSize: number,
    bufferSize: number,
    flags: number
  ): void;
}

/**
 * Emscripten FS (virtual file system) interface.
 * Used to write imported database files before opening with encryption.
 */
export interface EmscriptenFS {
  writeFile(path: string, data: Uint8Array): void;
  unlink(path: string): void;
}

/**
 * SQLite WASM module instance.
 * Includes Emscripten's virtual file system for file operations.
 */
export interface SQLite3Module {
  oo1: SQLiteOO1;
  capi: SQLiteCAPI;
  wasm: {
    exports: {
      memory: WebAssembly.Memory;
    };
  };
  /** Emscripten virtual file system - may not be available in all builds */
  FS?: EmscriptenFS;
  /** OPFS namespace - available after installOpfsVfs() */
  opfs?: unknown;
  /** Install OPFS VFS - may not be available in all builds */
  installOpfsVfs?: (options?: { proxyUri?: string }) => Promise<void>;
}

/**
 * Extended SQLiteOO1 interface with optional OPFS database class.
 */
export interface SQLiteOO1WithOpfs extends SQLiteOO1 {
  OpfsDb?: unknown;
}

/**
 * SQLite WASM initialization function type.
 * The locateFile option overrides how SQLite finds its companion files (wasm, proxy worker).
 */
export type SQLite3InitModule = (options: {
  print: typeof console.log;
  printErr: typeof console.error;
  locateFile?: (path: string, prefix: string) => string;
}) => Promise<SQLite3Module>;
