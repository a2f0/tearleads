/**
 * Database operations for SQLite WASM worker.
 */

import type { QueryParams, QueryResultData } from '../sqlite.worker.interface';
import type { SQLite3Module, SQLiteDatabase } from './types';

/**
 * Debug logging for SQLite worker.
 */
const DEBUG_SQLITE = import.meta.env?.DEV === true;

function debugLog(...args: unknown[]): void {
  if (DEBUG_SQLITE) {
    console.log(...args);
  }
}

/**
 * Convert a Uint8Array encryption key to a hex string for SQLite.
 */
export function keyToHex(key: Uint8Array): string {
  return Array.from(key)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Execute a SQL query and return results.
 */
export function execute(
  db: SQLiteDatabase | null,
  query: QueryParams
): QueryResultData {
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
export function executeMany(
  db: SQLiteDatabase | null,
  statements: string[]
): void {
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
export function beginTransaction(db: SQLiteDatabase | null): void {
  if (!db) {
    throw new Error('Database not initialized');
  }
  db.exec('BEGIN TRANSACTION');
}

/**
 * Commit the current transaction.
 */
export function commit(db: SQLiteDatabase | null): void {
  if (!db) {
    throw new Error('Database not initialized');
  }
  db.exec('COMMIT');
}

/**
 * Rollback the current transaction.
 */
export function rollback(db: SQLiteDatabase | null): void {
  if (!db) {
    throw new Error('Database not initialized');
  }
  db.exec('ROLLBACK');
}

/**
 * Re-key the database with a new encryption key.
 * Uses PRAGMA hexrekey for hex-encoded keys as per SQLite3MultipleCiphers docs.
 */
export function rekey(
  db: SQLiteDatabase | null,
  newKey: Uint8Array,
  setEncryptionKey: (key: string) => void
): void {
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

  setEncryptionKey(newHexKey);

  debugLog('Database re-keyed successfully');
}

/**
 * Export the database to a byte array.
 * Returns the encrypted database file content.
 */
export function exportDatabase(
  db: SQLiteDatabase | null,
  sqlite3: SQLite3Module | null
): Uint8Array {
  if (!db || !sqlite3) {
    throw new Error('Database not initialized');
  }

  // Export the database using the SQLite API
  // This gets the raw (encrypted) database file bytes
  const data = sqlite3.capi.sqlite3_js_db_export(db);
  debugLog('Exported database:', data.length, 'bytes');
  return data;
}

/**
 * Import a database from byte array.
 * Writes the encrypted database file to the WASM VFS and reopens it with encryption.
 */
export function importDatabase(
  data: Uint8Array,
  sqlite3: SQLite3Module | null,
  encryptionKey: string | null,
  currentDbFilename: string | null,
  setDb: (db: SQLiteDatabase | null) => void
): void {
  if (!sqlite3 || !encryptionKey || !currentDbFilename) {
    throw new Error('Database not initialized');
  }

  try {
    // Access Emscripten's virtual file system through the sqlite3 module
    // The FS module is attached to the sqlite3 object by Emscripten
    if (sqlite3.FS) {
      // Write the imported encrypted data directly to the VFS file
      sqlite3.FS.writeFile(currentDbFilename, data);
      debugLog('Wrote imported data to VFS:', currentDbFilename);
    } else {
      // Fallback: If FS is not available, try using sqlite3_deserialize
      // with a properly configured encrypted database
      console.warn('Emscripten FS not available, using deserialize fallback');

      // Open a new database with encryption key at the same filename
      // Opening with 'c' flag and hexkey will either open existing or create new
      const db = new sqlite3.oo1.DB({
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

      setDb(db);
      debugLog('Imported database via deserialize:', data.length, 'bytes');
      return;
    }

    // Reopen the database with encryption
    const db = new sqlite3.oo1.DB({
      filename: currentDbFilename,
      flags: 'c', // Open existing file
      hexkey: encryptionKey
    });

    // Verify the database is accessible
    db.exec('SELECT 1;');

    // Enable foreign keys
    db.exec('PRAGMA foreign_keys = ON;');

    setDb(db);
    debugLog('Imported database:', data.length, 'bytes');
  } catch (error) {
    console.error('Failed to import database:', error);
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to import database: ${message}`);
  }
}

/**
 * Delete the database file from OPFS.
 * This must be called after closing the database.
 */
export async function deleteDatabaseFile(name: string): Promise<void> {
  // Try to delete from OPFS using the File System Access API
  try {
    const opfsRoot = await navigator.storage.getDirectory();
    // The filename format used by OPFS-backed VFS
    const filename = `${name}.sqlite3`;

    try {
      await opfsRoot.removeEntry(filename);
      debugLog('Deleted OPFS database file:', filename);
    } catch {
      // File might not exist, which is fine
      debugLog('OPFS file not found or already deleted:', filename);
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
