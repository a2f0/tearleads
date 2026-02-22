/**
 * SQLite WASM initialization and database management.
 */

// Import sqlite3 statically - Vite will bundle this, avoiding dynamic import MIME type issues
// on Android WebView. We use locateFile to redirect wasm/worker lookups to /sqlite/.
// See issue #670 for details on the Android WebView MIME type problem.
// eslint-disable-next-line @typescript-eslint/no-require-imports
import sqlite3InitModuleFactory from '@/workers/sqlite-wasm/sqlite3.js';
import { keyToHex } from './operations';
import type { SQLite3InitModule, SQLite3Module, SQLiteDatabase } from './types';
import {
  ensureMultipleciphersVfs,
  getOpfsVfsName,
  getVfsList,
  installOpfsVfs as installOpfsVfsUtil
} from './vfs';

/**
 * Debug logging for SQLite worker.
 */
const DEBUG_SQLITE = import.meta.env?.DEV === true;

function debugLog(...args: unknown[]): void {
  if (DEBUG_SQLITE) {
    console.log(...args);
  }
}

const sqlite3InitModule: SQLite3InitModule = (options) =>
  sqlite3InitModuleFactory(options) as Promise<SQLite3Module>;

// Module state
let sqlite3: SQLite3Module | null = null;
let db: SQLiteDatabase | null = null;
let encryptionKey: string | null = null;
let currentDbFilename: string | null = null;
let sqliteBaseUrl: string | null = null;

// State accessors
export function getSqlite3(): SQLite3Module | null {
  return sqlite3;
}

export function getDb(): SQLiteDatabase | null {
  return db;
}

export function setDb(newDb: SQLiteDatabase | null): void {
  db = newDb;
}

export function getEncryptionKey(): string | null {
  return encryptionKey;
}

export function setEncryptionKey(key: string | null): void {
  encryptionKey = key;
}

export function getCurrentDbFilename(): string | null {
  return currentDbFilename;
}

/**
 * Initialize SQLite WASM module (only runs once per worker lifetime).
 */
async function initializeSqliteWasm(): Promise<void> {
  if (sqlite3) {
    debugLog('SQLite WASM already initialized');
    return;
  }

  // Base URL for SQLite companion files (wasm, OPFS proxy worker)
  // These are served from /sqlite/ in the public folder
  sqliteBaseUrl = new URL('/sqlite/', self.location.origin).href;
  debugLog('SQLite base URL:', sqliteBaseUrl);

  // Initialize the SQLite WASM module with locateFile override
  // This redirects wasm and worker file lookups to /sqlite/ in public folder
  // while keeping the main JS module bundled (avoiding Android WebView MIME type issues)
  // See issue #670 for details on the Android WebView MIME type problem
  try {
    sqlite3 = await sqlite3InitModule({
      print: debugLog,
      printErr: console.error,
      locateFile: (path: string, _prefix: string) => {
        // Redirect all file lookups to /sqlite/ base URL
        if (!sqliteBaseUrl) {
          throw new Error(
            'sqliteBaseUrl is not set before initializing the sqlite3 module.'
          );
        }
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

  debugLog('SQLite WASM initialized:', sqlite3.capi.sqlite3_libversion());
  debugLog('Available VFS classes:', Object.keys(sqlite3.oo1));

  // Log browser capabilities
  const hasStorageApi = typeof navigator?.storage?.getDirectory === 'function';
  debugLog('Browser capabilities:');
  debugLog('- navigator.storage.getDirectory:', hasStorageApi);
  debugLog('- crossOriginIsolated:', self.crossOriginIsolated === true);
  debugLog('- SharedArrayBuffer:', typeof SharedArrayBuffer !== 'undefined');
}

/**
 * Initialize SQLite WASM and open an encrypted database.
 * Attempts to use OPFS for persistence, falls back to in-memory if unavailable.
 */
export async function initializeDatabase(
  name: string,
  key: Uint8Array
): Promise<void> {
  // Close any existing database connection before opening a new one
  // This is critical for multi-instance support to avoid resource conflicts
  if (db) {
    closeDatabase();
  }

  // Initialize WASM module if not already done
  await initializeSqliteWasm();

  // Convert key to hex format for SQLite encryption
  encryptionKey = keyToHex(key);

  if (!sqlite3) {
    throw new Error('SQLite module not initialized');
  }

  // Try to install OPFS VFS for persistence
  const hasOpfs = await installOpfsVfsUtil(sqlite3, sqliteBaseUrl);
  let vfsList = getVfsList(sqlite3);
  debugLog('SQLite VFS list:', vfsList);
  if (hasOpfs && vfsList.includes('opfs')) {
    const created = ensureMultipleciphersVfs(sqlite3, 'opfs');
    if (created) {
      vfsList = getVfsList(sqlite3);
      debugLog('SQLite VFS list after mc create:', vfsList);
    }
  }

  // Use OPFS filename if available, otherwise use in-memory
  // OPFS files persist across page reloads
  if (hasOpfs) {
    const vfsName = getOpfsVfsName(sqlite3);
    if (vfsName) {
      currentDbFilename = `file:${name}.sqlite3?vfs=${vfsName}`;
      debugLog(`Using ${vfsName} VFS for encrypted persistence`);
    } else {
      currentDbFilename = `${name}.sqlite3`;
      console.warn(
        'OPFS requested but no OPFS VFS registered; falling back to in-memory'
      );
    }
  } else {
    currentDbFilename = `${name}.sqlite3`;
    debugLog('Using in-memory VFS (data will not persist across reloads)');
  }

  // Helper to open the database (uses captured variables from outer scope)
  const openDatabase = () => {
    if (!sqlite3 || !currentDbFilename || !encryptionKey) {
      throw new Error('Database initialization state is invalid');
    }
    db = new sqlite3.oo1.DB({
      filename: currentDbFilename,
      flags: 'c', // Create if not exists
      hexkey: encryptionKey
    });
    // Verify encryption is working
    db.exec('SELECT 1;');
    // Enable foreign keys
    db.exec('PRAGMA foreign_keys = ON;');
  };

  try {
    // Create/open encrypted database
    openDatabase();
    debugLog('Encrypted database opened successfully:', currentDbFilename);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);

    // If the error is SQLITE_NOTADB (file exists but wrong key or corrupted),
    // try deleting the file and creating fresh. This handles cases where:
    // 1. A previous test left orphaned files with different encryption
    // 2. The clearOriginStorage didn't fully clear OPFS
    // 3. The file got corrupted
    if (
      message.includes('SQLITE_NOTADB') ||
      message.includes('not a database')
    ) {
      console.warn(
        'Database file appears corrupted or has wrong key, attempting to delete and recreate...'
      );

      // Close any partially-opened database to release handles before deleting
      if (db) {
        closeDatabase();
      }

      // Delete the corrupted file from OPFS
      try {
        const opfsRoot = await navigator.storage.getDirectory();
        const filename = `${name}.sqlite3`;
        try {
          await opfsRoot.removeEntry(filename);
          debugLog('Deleted corrupted OPFS file:', filename);
        } catch {
          // File might not exist
        }
        // Also delete journal/WAL files
        for (const suffix of ['-journal', '-wal', '-shm']) {
          try {
            await opfsRoot.removeEntry(filename + suffix);
          } catch {
            // Ignore
          }
        }
      } catch {
        // OPFS not available or delete failed, continue anyway
      }

      // Retry opening/creating the database
      try {
        openDatabase();
        debugLog(
          'Database created successfully after deleting corrupted file:',
          currentDbFilename
        );
      } catch (retryError) {
        console.error('Failed to create database after cleanup:', retryError);
        const retryMessage =
          retryError instanceof Error ? retryError.message : String(retryError);
        throw new Error(
          `Failed to open encrypted database: ${retryMessage}. ` +
            'Encryption may not be supported in this browser.'
        );
      }
    } else {
      console.error('Failed to open encrypted database:', error);
      throw new Error(
        `Failed to open encrypted database: ${message}. ` +
          'Encryption may not be supported in this browser.'
      );
    }
  }
}

/**
 * Close the database.
 */
export function closeDatabase(): void {
  if (db) {
    db.close();
    db = null;
  }

  // Clear sensitive data from memory
  encryptionKey = null;
  currentDbFilename = null;
}
