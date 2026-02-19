/**
 * Database import/export operations for Electron SQLite.
 */

import fs from 'node:fs';
import Database from 'better-sqlite3-multiple-ciphers';
import {
  closeDatabase,
  getDb,
  getDatabasePath,
  getNativeBindingPath,
  setDb
} from './databaseOperations';
import { secureZeroBuffer } from './keyStorage';

/**
 * Delete the database file.
 */
export function deleteDatabase(name: string): void {
  closeDatabase();

  const dbPath = getDatabasePath(name);

  // Delete database files (force: true handles non-existent files gracefully)
  fs.rmSync(dbPath, { force: true });
  fs.rmSync(`${dbPath}-wal`, { force: true });
  fs.rmSync(`${dbPath}-shm`, { force: true });
}

/**
 * Export the database to a buffer.
 * Checkpoints WAL to ensure all data is in the main file.
 */
export async function exportDatabase(name: string): Promise<Buffer> {
  const db = getDb();
  if (!db) {
    throw new Error('Database not initialized');
  }

  // Checkpoint WAL to ensure all data is in main file
  db.exec('PRAGMA wal_checkpoint(TRUNCATE);');

  const dbPath = getDatabasePath(name);

  // Read the encrypted database file asynchronously
  return fs.promises.readFile(dbPath);
}

/**
 * Import a database from a buffer.
 * Creates a backup of the current database before replacing it.
 * After import, re-opens the database with the provided encryption key.
 * @param name The database name
 * @param data The encrypted database file as a Buffer
 * @param key The encryption key to use when reopening the database
 */
export async function importDatabase(
  name: string,
  data: Buffer,
  key: number[]
): Promise<void> {
  const dbPath = getDatabasePath(name);
  const backupPath = `${dbPath}.backup`;
  const walPath = `${dbPath}-wal`;
  const shmPath = `${dbPath}-shm`;

  // Create backup of current database before import
  try {
    await fs.promises.copyFile(dbPath, backupPath);
  } catch {
    // Ignore if file doesn't exist (first time setup)
  }

  // Close the current database
  closeDatabase();

  try {
    // Delete WAL and SHM files
    try {
      await fs.promises.unlink(walPath);
    } catch {
      // Ignore if file doesn't exist
    }
    try {
      await fs.promises.unlink(shmPath);
    } catch {
      // Ignore if file doesn't exist
    }

    // Write the imported data
    await fs.promises.writeFile(dbPath, data);

    // Reopen the database with encryption
    const nativeBindingPath = getNativeBindingPath();
    const db = new Database(dbPath, {
      nativeBinding: nativeBindingPath,
    });

    const keyBuffer = Buffer.from(key);
    const keyHex = keyBuffer.toString('hex');
    secureZeroBuffer(keyBuffer);

    // Apply encryption settings
    db.pragma(`cipher='chacha20'`);
    db.pragma(`key="x'${keyHex}'"`);

    // Verify key and enable standard pragmas
    try {
      db.exec('SELECT 1');
      db.pragma('journal_mode = WAL');
      db.pragma('foreign_keys = ON');
    } catch (error) {
      db.close();
      setDb(null);
      throw new Error(
        'Failed to open imported database: invalid encryption key'
      );
    }

    // Set the new database instance
    setDb(db);

    // Remove backup on success
    try {
      await fs.promises.unlink(backupPath);
    } catch {
      // Ignore cleanup errors
    }
  } catch (error) {
    // Restore from backup on failure
    try {
      await fs.promises.copyFile(backupPath, dbPath);
      // Also restore WAL/SHM files were deleted, but original DB should work
      // without them since closeDatabase() was called which flushes WAL
    } catch {
      // Best effort restore - if this fails, database may be corrupted
    }

    // Ensure db is null so caller knows to re-unlock
    // The database file has been restored but needs to be reopened
    setDb(null);

    // Re-throw with more context about recovery state
    const originalMessage =
      error instanceof Error ? error.message : String(error);
    throw new Error(
      `Import failed: ${originalMessage}. ` +
        'Database has been restored from backup. Please unlock again.'
    );
  }
}
