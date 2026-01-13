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
 * Emscripten FS (virtual file system) interface.
 * Used to write imported database files before opening with encryption.
 */
interface EmscriptenFS {
  writeFile(path: string, data: Uint8Array): void;
  unlink(path: string): void;
}

/**
 * SQLite WASM module instance.
 * Includes Emscripten's virtual file system for file operations.
 */
interface SQLite3Module {
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
  installOpfsVfs?: () => Promise<void>;
}

/**
 * Extended SQLiteOO1 interface with optional OPFS database class.
 */
interface SQLiteOO1WithOpfs extends SQLiteOO1 {
  OpfsDb?: unknown;
}

function hasOpfsDb(oo1: SQLiteOO1): oo1 is SQLiteOO1WithOpfs {
  return 'OpfsDb' in oo1;
}

/**
 * SQLite WASM initialization function type.
 * The locateFile option overrides how SQLite finds its companion files (wasm, proxy worker).
 */
type SQLite3InitModule = (options: {
  print: typeof console.log;
  printErr: typeof console.error;
  locateFile?: (path: string, prefix: string) => string;
}) => Promise<SQLite3Module>;

// Import sqlite3 statically - Vite will bundle this, avoiding dynamic import MIME type issues
// on Android WebView. We use locateFile to redirect wasm/worker lookups to /sqlite/.
// See issue #670 for details on the Android WebView MIME type problem.
// eslint-disable-next-line @typescript-eslint/no-require-imports
import sqlite3InitModuleFactory from '@/workers/sqlite-wasm/sqlite3.js';

const sqlite3InitModule =
  sqlite3InitModuleFactory as unknown as SQLite3InitModule;
let sqlite3: SQLite3Module | null = null;
let db: SQLiteDatabase | null = null;
let encryptionKey: string | null = null;
let currentDbFilename: string | null = null;

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

  // Base URL for SQLite companion files (wasm, OPFS proxy worker)
  // These are served from /sqlite/ in the public folder
  const sqliteBaseUrl = new URL('/sqlite/', self.location.origin).href;
  console.log('SQLite base URL:', sqliteBaseUrl);

  // Initialize the SQLite WASM module with locateFile override
  // This redirects wasm and worker file lookups to /sqlite/ in public folder
  // while keeping the main JS module bundled (avoiding Android WebView MIME type issues)
  // See issue #670 for details on the Android WebView MIME type problem
  try {
    sqlite3 = await sqlite3InitModule({
      print: console.log,
      printErr: console.error,
      locateFile: (path: string, _prefix: string) => {
        // Redirect all file lookups to /sqlite/ base URL
        return new URL(path, sqliteBaseUrl).href;
      }
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
 * Check if OPFS VFS is available and install it.
 */
async function installOpfsVfs(): Promise<boolean> {
  if (!sqlite3) return false;

  // Check if OPFS is already available
  if (sqlite3.opfs) {
    console.log('OPFS VFS already installed');
    return true;
  }

  // Check browser support for OPFS
  if (typeof navigator?.storage?.getDirectory !== 'function') {
    console.warn('OPFS not supported in this browser');
    return false;
  }

  // Try to install OPFS VFS
  try {
    if (typeof sqlite3.installOpfsVfs === 'function') {
      await sqlite3.installOpfsVfs();
      console.log('OPFS VFS installed successfully');
      return true;
    }

    // Alternative: check for OpfsDb class
    if (hasOpfsDb(sqlite3.oo1) && sqlite3.oo1.OpfsDb) {
      console.log('OpfsDb class available');
      return true;
    }

    console.warn('OPFS VFS installation not available');
    return false;
  } catch (error) {
    console.warn('Failed to install OPFS VFS:', error);
    return false;
  }
}

/**
 * Initialize SQLite WASM and open an encrypted database.
 * Attempts to use OPFS for persistence, falls back to in-memory if unavailable.
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

  // Try to install OPFS VFS for persistence
  const hasOpfs = await installOpfsVfs();

  // Use OPFS filename if available, otherwise use in-memory
  // OPFS files persist across page reloads
  // Use multipleciphers-opfs VFS which wraps OPFS with encryption support
  // See: https://utelle.github.io/SQLite3MultipleCiphers/docs/architecture/arch_vfs/
  if (hasOpfs) {
    currentDbFilename = `file:${name}.sqlite3?vfs=multipleciphers-opfs`;
    console.log('Using multipleciphers-opfs VFS for encrypted persistence');
  } else {
    currentDbFilename = `${name}.sqlite3`;
    console.log('Using in-memory VFS (data will not persist across reloads)');
  }

  try {
    // Create/open encrypted database
    db = new sqlite3.oo1.DB({
      filename: currentDbFilename,
      flags: 'c', // Create if not exists
      hexkey: encryptionKey
    });

    // Verify encryption is working
    db.exec('SELECT 1;');

    // Enable foreign keys
    db.exec('PRAGMA foreign_keys = ON;');

    console.log('Encrypted database opened successfully:', currentDbFilename);
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
  newKey.fill(0); // Zero out the key from memory

  // Checkpoint WAL data BEFORE rekey to ensure all data is in the main database
  // This is critical for ensuring the rekey operation processes all data
  db.exec('PRAGMA wal_checkpoint(TRUNCATE);');

  // Use PRAGMA hexrekey for hex-encoded keys
  // See: https://utelle.github.io/SQLite3MultipleCiphers/docs/configuration/config_sql_pragmas/
  db.exec(`PRAGMA hexrekey = '${newHexKey}';`);

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
 * Writes the encrypted database file to the WASM VFS and reopens it with encryption.
 *
 * The approach is:
 * 1. Close the current database
 * 2. Write the imported bytes to the database file in the WASM VFS
 * 3. Reopen the database with the encryption key
 *
 * This works because the imported data is already encrypted with the same key.
 */
function importDatabase(data: Uint8Array): void {
  if (!sqlite3 || !encryptionKey || !currentDbFilename) {
    throw new Error('Database not initialized');
  }

  // Close the current database to release the file
  if (db) {
    db.close();
    db = null;
  }

  try {
    // Access Emscripten's virtual file system through the sqlite3 module
    // The FS module is attached to the sqlite3 object by Emscripten
    if (sqlite3.FS) {
      // Write the imported encrypted data directly to the VFS file
      sqlite3.FS.writeFile(currentDbFilename, data);
      console.log('Wrote imported data to VFS:', currentDbFilename);
    } else {
      // Fallback: If FS is not available, try using sqlite3_deserialize
      // with a properly configured encrypted database
      console.warn('Emscripten FS not available, using deserialize fallback');

      // Open a new database with encryption key at the same filename
      // Opening with 'c' flag and hexkey will either open existing or create new
      db = new sqlite3.oo1.DB({
        filename: currentDbFilename,
        flags: 'c',
        hexkey: encryptionKey
      });

      // Use sqlite3_deserialize to replace the database content
      // With the key already set, the deserialized encrypted content should work
      sqlite3.capi.sqlite3_deserialize(
        db.pointer,
        'main',
        data,
        data.length,
        data.length,
        0 // No flags
      );

      // Verify the database is accessible
      db.exec('SELECT 1;');
      db.exec('PRAGMA foreign_keys = ON;');

      console.log('Imported database via deserialize:', data.length, 'bytes');
      return;
    }

    // Reopen the database with encryption
    db = new sqlite3.oo1.DB({
      filename: currentDbFilename,
      flags: 'c', // Open existing file
      hexkey: encryptionKey
    });

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

  // Clear sensitive data from memory
  encryptionKey = null;
  currentDbFilename = null;
}

/**
 * Delete the database file from OPFS.
 * This must be called after closing the database.
 */
async function deleteDatabaseFile(name: string): Promise<void> {
  // Close the database first if it's open
  closeDatabase();

  // Try to delete from OPFS using the File System Access API
  try {
    const opfsRoot = await navigator.storage.getDirectory();
    // The filename format used by multipleciphers-opfs VFS
    const filename = `${name}.sqlite3`;

    try {
      await opfsRoot.removeEntry(filename);
      console.log('Deleted OPFS database file:', filename);
    } catch {
      // File might not exist, which is fine
      console.log('OPFS file not found or already deleted:', filename);
    }

    // Also try to delete any journal/WAL files
    for (const suffix of ['-journal', '-wal', '-shm']) {
      try {
        await opfsRoot.removeEntry(filename + suffix);
      } catch {
        // Ignore if not found
      }
    }
  } catch (error) {
    console.warn('Failed to delete OPFS files:', error);
    // Don't throw - the file might not exist which is fine
  }
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

      case 'DELETE_DATABASE': {
        await deleteDatabaseFile(request.name);
        respond({ type: 'SUCCESS', id: request.id });
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
