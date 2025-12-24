/**
 * SQLite Web Worker using official SQLite WASM with encryption support.
 * Uses SQLite3MultipleCiphers for at-rest encryption with OPFS storage.
 */

/// <reference lib="webworker" />

import type {
  QueryParams,
  QueryResultData,
  WorkerRequest,
  WorkerResponse
} from './sqlite.worker.interface';

/**
 * SQLite WASM Database instance type.
 * Represents an open database connection.
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
  ): void;
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
}) => Promise<SQLite3Module>;

// SQLite WASM module - loaded dynamically from public folder to preserve import.meta.url
// This is necessary because the OPFS VFS uses import.meta.url to locate its proxy worker
let sqlite3InitModule: SQLite3InitModule | null = null;
let sqlite3: SQLite3Module | null = null;
let db: SQLiteDatabase | null = null;
let encryptionKey: string | null = null;

/**
 * Convert a Uint8Array encryption key to a hex string for SQLite.
 */
function keyToHex(key: Uint8Array): string {
  return Array.from(key)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Initialize SQLite WASM module (only runs once per worker lifetime).
 */
async function initializeSqliteWasm(): Promise<void> {
  if (sqlite3) {
    console.log('SQLite WASM already initialized');
    return;
  }

  // Dynamically import sqlite3 from the public folder
  // This preserves import.meta.url so OPFS can find its proxy worker
  const sqliteModuleUrl = new URL('/sqlite/sqlite3.mjs', self.location.origin)
    .href;

  console.log('Loading SQLite WASM from:', sqliteModuleUrl);

  try {
    const module = await import(/* @vite-ignore */ sqliteModuleUrl);
    sqlite3InitModule = module.default;

    if (!sqlite3InitModule) {
      throw new Error('Failed to load sqlite3InitModule from module');
    }
  } catch (error) {
    console.error('Failed to load SQLite module:', error);
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to load SQLite WASM: ${message}`);
  }

  // Initialize the SQLite WASM module
  try {
    sqlite3 = await sqlite3InitModule({
      print: console.log,
      printErr: console.error
    });
  } catch (error) {
    console.error('Failed to initialize SQLite:', error);
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to initialize SQLite: ${message}`);
  }

  if (!sqlite3 || !sqlite3.oo1 || !sqlite3.capi) {
    throw new Error('SQLite module loaded but missing expected properties');
  }

  console.log('SQLite WASM initialized:', sqlite3.capi.sqlite3_libversion());
  console.log('Available VFS classes:', Object.keys(sqlite3.oo1));

  // Log browser capabilities
  const hasStorageApi = typeof navigator?.storage?.getDirectory === 'function';
  console.log('Browser capabilities:');
  console.log('- navigator.storage.getDirectory:', hasStorageApi);
}

/**
 * Initialize SQLite WASM and open an encrypted database.
 */
async function initializeDatabase(
  name: string,
  key: Uint8Array
): Promise<void> {
  // Initialize WASM module if not already done
  await initializeSqliteWasm();

  // Convert key to hex format for SQLite encryption
  encryptionKey = keyToHex(key);

  if (!sqlite3) {
    throw new Error('SQLite module not initialized');
  }

  // Use encrypted file-based database in WASM virtual file system
  // Note: This uses the default VFS which supports encryption
  // Data persists in WASM memory until worker terminates
  const dbFilename = `${name}.sqlite3`;

  try {
    // Create/open encrypted database using the default VFS with hexkey parameter
    db = new sqlite3.oo1.DB({
      filename: dbFilename,
      flags: 'c', // Create if not exists
      hexkey: encryptionKey
    });

    // Verify encryption is working
    db.exec('SELECT 1;');

    // Enable foreign keys
    db.exec('PRAGMA foreign_keys = ON;');

    console.log('Encrypted database opened successfully:', dbFilename);
  } catch (error) {
    console.error('Failed to open encrypted database:', error);
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(
      `Failed to open encrypted database: ${message}. ` +
        'Encryption may not be supported in this browser.'
    );
  }
}

/**
 * Execute a SQL query and return results.
 */
function execute(query: QueryParams): QueryResultData {
  if (!db) {
    throw new Error('Database not initialized');
  }

  const { sql, params = [], method = 'all' } = query;
  const rows: Record<string, unknown>[] = [];
  const bindParams = params.length > 0 ? params : undefined;

  if (method === 'run') {
    // Execute without returning rows
    if (bindParams) {
      db.exec({ sql, bind: bindParams });
    } else {
      db.exec(sql);
    }
  } else {
    // Execute and collect results
    const callback = (row: Record<string, unknown>): boolean | undefined => {
      if (method === 'get' && rows.length > 0) {
        return false; // Stop after first row
      }
      rows.push(row);
      return undefined;
    };

    if (bindParams) {
      db.exec({ sql, bind: bindParams, rowMode: 'object', callback });
    } else {
      db.exec({ sql, rowMode: 'object', callback });
    }
  }

  // Get changes count and last insert row ID
  const changes = db.changes();
  const lastInsertRowId = Number(
    db.exec({
      sql: 'SELECT last_insert_rowid()',
      returnValue: 'resultRows'
    })[0]?.[0] ?? 0
  );

  return { rows, changes, lastInsertRowId };
}

/**
 * Execute multiple statements in sequence.
 */
function executeMany(statements: string[]): void {
  if (!db) {
    throw new Error('Database not initialized');
  }

  for (const sql of statements) {
    db.exec(sql);
  }
}

/**
 * Begin a transaction.
 */
function beginTransaction(): void {
  if (!db) {
    throw new Error('Database not initialized');
  }
  db.exec('BEGIN TRANSACTION');
}

/**
 * Commit the current transaction.
 */
function commit(): void {
  if (!db) {
    throw new Error('Database not initialized');
  }
  db.exec('COMMIT');
}

/**
 * Rollback the current transaction.
 */
function rollback(): void {
  if (!db) {
    throw new Error('Database not initialized');
  }
  db.exec('ROLLBACK');
}

/**
 * Re-key the database with a new encryption key.
 * Uses PRAGMA hexrekey for hex-encoded keys as per SQLite3MultipleCiphers docs.
 */
function rekey(newKey: Uint8Array): void {
  if (!db) {
    throw new Error('Database not initialized');
  }

  const newHexKey = keyToHex(newKey);

  // Use PRAGMA hexrekey for hex-encoded keys
  // See: https://utelle.github.io/SQLite3MultipleCiphers/docs/configuration/config_sql_pragmas/
  db.exec(`PRAGMA hexrekey = '${newHexKey}';`);

  // Force a checkpoint to ensure changes are written to the database file
  db.exec('PRAGMA wal_checkpoint(TRUNCATE);');

  encryptionKey = newHexKey;

  console.log('Database re-keyed successfully');
}

/**
 * Export the database to a byte array.
 * Returns the encrypted database file content.
 */
function exportDatabase(): Uint8Array {
  if (!db || !sqlite3) {
    throw new Error('Database not initialized');
  }

  // Export the database using the SQLite API
  // This gets the raw (encrypted) database file bytes
  const data = sqlite3.capi.sqlite3_js_db_export(db);
  console.log('Exported database:', data.length, 'bytes');
  return data;
}

/**
 * Import a database from byte array.
 * Loads an encrypted database file into the current database.
 */
function importDatabase(data: Uint8Array): void {
  if (!db || !sqlite3) {
    throw new Error('Database not initialized');
  }

  if (!encryptionKey) {
    throw new Error('Encryption key not set');
  }

  // Close the current database
  db.close();

  // Create a new database and deserialize the data
  db = new sqlite3.oo1.DB({
    filename: ':memory:', // Temporary in-memory
    flags: 'c'
  });

  // Use sqlite3_deserialize to load the data
  // The data is already encrypted, so we need to set the key after loading
  try {
    sqlite3.capi.sqlite3_deserialize(
      db.pointer,
      'main',
      data,
      data.length,
      data.length,
      0 // No flags - don't free the data
    );

    // Set the encryption key for the loaded database using hexkey pragma
    db.exec(`PRAGMA hexkey = '${encryptionKey}';`);

    // Verify the database is accessible
    db.exec('SELECT 1;');

    // Enable foreign keys
    db.exec('PRAGMA foreign_keys = ON;');

    console.log('Imported database:', data.length, 'bytes');
  } catch (error) {
    console.error('Failed to import database:', error);
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to import database: ${message}`);
  }
}

/**
 * Close the database.
 */
function closeDatabase(): void {
  if (db) {
    db.close();
    db = null;
  }

  // Clear the encryption key from memory
  encryptionKey = null;
}

/**
 * Send a response to the main thread.
 */
function respond(response: WorkerResponse): void {
  self.postMessage(response);
}

/**
 * Handle messages from the main thread.
 */
self.onmessage = async (event: MessageEvent<WorkerRequest>) => {
  const request = event.data;

  try {
    switch (request.type) {
      case 'INIT': {
        await initializeDatabase(
          request.config.name,
          new Uint8Array(request.config.encryptionKey)
        );
        respond({ type: 'INIT_SUCCESS', id: request.id });
        break;
      }

      case 'EXECUTE': {
        const result = execute(request.query);
        respond({ type: 'RESULT', id: request.id, data: result });
        break;
      }

      case 'EXECUTE_MANY': {
        executeMany(request.statements);
        respond({ type: 'SUCCESS', id: request.id });
        break;
      }

      case 'BEGIN_TRANSACTION': {
        beginTransaction();
        respond({ type: 'SUCCESS', id: request.id });
        break;
      }

      case 'COMMIT': {
        commit();
        respond({ type: 'SUCCESS', id: request.id });
        break;
      }

      case 'ROLLBACK': {
        rollback();
        respond({ type: 'SUCCESS', id: request.id });
        break;
      }

      case 'REKEY': {
        rekey(new Uint8Array(request.newKey));
        respond({ type: 'SUCCESS', id: request.id });
        break;
      }

      case 'EXPORT': {
        const exportData = exportDatabase();
        respond({
          type: 'EXPORT_RESULT',
          id: request.id,
          data: Array.from(exportData)
        });
        break;
      }

      case 'IMPORT': {
        importDatabase(new Uint8Array(request.data));
        respond({ type: 'SUCCESS', id: request.id });
        break;
      }

      case 'CLOSE': {
        closeDatabase();
        respond({ type: 'CLOSED', id: request.id });
        break;
      }
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const errorResponse: WorkerResponse = {
      type: 'ERROR',
      id: 'id' in request ? request.id : 'unknown',
      error: message
    };
    respond(errorResponse);
  }
};

// Signal that the worker is ready
respond({ type: 'READY' });
