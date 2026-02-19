/**
 * Core database operations for Electron SQLite.
 */

import { isRecord } from '@tearleads/shared';
import fs from 'node:fs';
import path from 'node:path';
import { app } from 'electron';
import Database from 'better-sqlite3-multiple-ciphers';
import { resolveSqliteNativeBindingPath } from './nativeBinding';
import type { InitializeConfig, QueryResult } from './types';
import { secureZeroBuffer } from './keyStorage';

let db: Database.Database | null = null;

/**
 * Get the database file path.
 */
export function getDatabasePath(name: string): string {
  const userDataPath = app.getPath('userData');
  return path.join(userDataPath, `${name}.db`);
}

export const getNativeBindingPath = ((): (() => string) => {
  let cachedPath: string | undefined;

  return (): string => {
    if (cachedPath) {
      return cachedPath;
    }

    const nativeBindingPath = resolveSqliteNativeBindingPath({
      // Built Electron main code lives in packages/client/out/main.
      // Walk up to packages/client so generated native artifacts resolve correctly.
      devBasePath: path.resolve(__dirname, '../..'),
      envOverride: process.env['TEARLEADS_SQLITE_NATIVE_BINDING'],
      isPackaged: app.isPackaged,
      resourcesPath: process.resourcesPath,
    });

    if (!fs.existsSync(nativeBindingPath)) {
      throw new Error(
        `Missing Electron SQLite native binary at ${nativeBindingPath}. Run "pnpm --filter @tearleads/client electron:prepare-sqlite".`
      );
    }

    cachedPath = nativeBindingPath;
    return cachedPath;
  };
})();

/**
 * Get the current database instance.
 */
export function getDb(): Database.Database | null {
  return db;
}

/**
 * Set the database instance (used by import operations).
 */
export function setDb(database: Database.Database | null): void {
  db = database;
}

/**
 * Initialize the database with encryption.
 */
export function initializeDatabase(config: InitializeConfig): void {
  if (db) {
    throw new Error('Database already initialized');
  }

  const dbPath = getDatabasePath(config.name);
  const nativeBindingPath = getNativeBindingPath();
  const keyBuffer = Buffer.from(config.encryptionKey);

  try {
    // Open database with encryption
    db = new Database(dbPath, {
      nativeBinding: nativeBindingPath,
    });

    // Set up encryption using SQLite3MultipleCiphers
    // Use ChaCha20-Poly1305 cipher (recommended)
    db.pragma(`cipher='chacha20'`);

    // Convert to hex for the pragma, then immediately zero the source buffer
    const keyHex = keyBuffer.toString('hex');
    secureZeroBuffer(keyBuffer);

    db.pragma(`key="x'${keyHex}'"`);

    // Verify the key works by running a simple query
    // Note: cipher_integrity_check only works on existing encrypted databases
    // For new databases or verification, we use a simple table check
    try {
      // This will fail with "SQLITE_NOTADB: file is not a database"
      // if the key is wrong for an existing encrypted database
      db.exec('SELECT 1');
    } catch (error) {
      db.close();
      db = null;
      throw new Error('Invalid encryption key');
    }

    // Enable WAL mode for better performance
    db.pragma('journal_mode = WAL');

    // Enable foreign keys
    db.pragma('foreign_keys = ON');

    console.log(`Database initialized at: ${dbPath}`);
  } catch (error) {
    // Ensure we zero the buffer even on error
    secureZeroBuffer(keyBuffer);
    throw error;
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
}

/**
 * Execute a SQL query.
 */
export function execute(sql: string, params?: unknown[]): QueryResult {
  if (!db) {
    throw new Error('Database not initialized');
  }

  const stmt = db.prepare(sql);
  const trimmedSql = sql.trim().toUpperCase();
  // PRAGMA with = is a setter (e.g., PRAGMA foreign_keys = ON) and doesn't return data.
  // Only treat PRAGMA as a query when it doesn't contain = (e.g., PRAGMA table_info(...)).
  const isPragmaQuery =
    trimmedSql.startsWith('PRAGMA') && !trimmedSql.includes('=');
  const isSelect = trimmedSql.startsWith('SELECT') || isPragmaQuery;

  if (isSelect) {
    const rows = params ? stmt.all(...params) : stmt.all();
    const safeRows = Array.isArray(rows) ? rows.filter(isRecord) : [];
    return { rows: safeRows };
  }

  const result = params ? stmt.run(...params) : stmt.run();
  return {
    rows: [],
    changes: result.changes,
    lastInsertRowId: Number(result.lastInsertRowid)
  };
}

/**
 * Execute multiple SQL statements atomically within a transaction.
 * Uses better-sqlite3's transaction() for automatic rollback on error.
 */
export function executeMany(statements: string[]): void {
  if (!db) {
    throw new Error('Database not initialized');
  }

  const runStatements = db.transaction((stmts: string[]) => {
    for (const sql of stmts) {
      db!.exec(sql);
    }
  });

  runStatements(statements);
}

/**
 * Begin a transaction.
 */
export function beginTransaction(): void {
  execute('BEGIN TRANSACTION');
}

/**
 * Commit the current transaction.
 */
export function commit(): void {
  execute('COMMIT');
}

/**
 * Rollback the current transaction.
 */
export function rollback(): void {
  execute('ROLLBACK');
}

/**
 * Re-key the database with a new encryption key.
 * Uses the native rekey() method which directly calls sqlite3_rekey().
 * See: https://github.com/m4heshd/better-sqlite3-multiple-ciphers/blob/master/docs/api.md
 */
export function rekey(newKey: number[]): void {
  if (!db) {
    throw new Error('Database not initialized');
  }

  const keyBuffer = Buffer.from(newKey);
  newKey.fill(0); // Zero out the original key array from memory

  // Rekeying is not supported in WAL mode, so we need to:
  // 1. Checkpoint all WAL data
  // 2. Switch to DELETE journal mode
  // 3. Perform the rekey
  // 4. Switch back to WAL mode

  try {
    // Checkpoint all WAL data to main database
    db.exec('PRAGMA wal_checkpoint(TRUNCATE);');

    // Switch to DELETE journal mode (required for rekey)
    db.exec('PRAGMA journal_mode = DELETE;');

    // Use PRAGMA rekey with hex format to match how we initialize
    // Initialize uses: PRAGMA key="x'HEXKEY'"
    // Rekey must use: PRAGMA rekey="x'HEXKEY'"
    const keyHex = keyBuffer.toString('hex');
    db.pragma(`rekey="x'${keyHex}'"`);
  } finally {
    // Always restore WAL mode and zero the buffer, even if rekey fails
    // Use nested try/finally to ensure buffer is zeroed even if WAL restore fails
    try {
      db.exec('PRAGMA journal_mode = WAL;');
    } finally {
      secureZeroBuffer(keyBuffer);
    }
  }
}
