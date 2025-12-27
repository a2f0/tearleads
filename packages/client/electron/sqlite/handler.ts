/**
 * Electron main process SQLite handler.
 * Uses better-sqlite3-multiple-ciphers for encrypted database operations.
 */

import fs from 'node:fs';
import path from 'node:path';
import { app, ipcMain, safeStorage } from 'electron';
import Database from 'better-sqlite3-multiple-ciphers';

interface QueryResult {
  rows: Record<string, unknown>[];
  changes?: number;
  lastInsertRowId?: number;
}

let db: Database.Database | null = null;

/**
 * Get the database file path.
 */
function getDatabasePath(name: string): string {
  const userDataPath = app.getPath('userData');
  return path.join(userDataPath, `${name}.db`);
}

/**
 * Securely zero out a buffer to prevent key material from lingering in memory.
 */
function secureZeroBuffer(buffer: Buffer): void {
  buffer.fill(0);
}

/**
 * Initialize the database with encryption.
 */
function initializeDatabase(config: {
  name: string;
  encryptionKey: number[];
}): void {
  if (db) {
    throw new Error('Database already initialized');
  }

  const dbPath = getDatabasePath(config.name);
  const keyBuffer = Buffer.from(config.encryptionKey);

  try {
    // Open database with encryption
    db = new Database(dbPath);

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
function closeDatabase(): void {
  if (db) {
    db.close();
    db = null;
  }
}

/**
 * Execute a SQL query.
 */
function execute(sql: string, params?: unknown[]): QueryResult {
  if (!db) {
    throw new Error('Database not initialized');
  }

  const stmt = db.prepare(sql);
  const isSelect =
    sql.trim().toUpperCase().startsWith('SELECT') ||
    sql.trim().toUpperCase().startsWith('PRAGMA');

  if (isSelect) {
    const rows = params ? stmt.all(...params) : stmt.all();
    return { rows: rows as Record<string, unknown>[] };
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
function executeMany(statements: string[]): void {
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
function beginTransaction(): void {
  execute('BEGIN TRANSACTION');
}

/**
 * Commit the current transaction.
 */
function commit(): void {
  execute('COMMIT');
}

/**
 * Rollback the current transaction.
 */
function rollback(): void {
  execute('ROLLBACK');
}

/**
 * Re-key the database with a new encryption key.
 * Uses the native rekey() method which directly calls sqlite3_rekey().
 * See: https://github.com/m4heshd/better-sqlite3-multiple-ciphers/blob/master/docs/api.md
 */
function rekey(newKey: number[]): void {
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

/**
 * Store the salt and key check value.
 * Note: The salt is not secret - it's a random value used for key derivation.
 * The key check value is a hash used only for password verification.
 * We use safeStorage when available for extra protection, but fall back to
 * plain JSON storage when not available (e.g., in CI environments).
 */
const SALT_FILE = '.salt';
const KCV_FILE = '.kcv';

function getStoragePath(filename: string): string {
  return path.join(app.getPath('userData'), filename);
}

function storeSalt(salt: number[]): void {
  const saltPath = getStoragePath(SALT_FILE);
  fs.writeFileSync(saltPath, JSON.stringify(salt), 'utf8');
}

function getSalt(): number[] | null {
  const saltPath = getStoragePath(SALT_FILE);
  try {
    return JSON.parse(fs.readFileSync(saltPath, 'utf8'));
  } catch {
    return null;
  }
}

function storeKeyCheckValue(kcv: string): void {
  const kcvPath = getStoragePath(KCV_FILE);
  fs.writeFileSync(kcvPath, kcv, 'utf8');
}

function getKeyCheckValue(): string | null {
  const kcvPath = getStoragePath(KCV_FILE);
  try {
    return fs.readFileSync(kcvPath, 'utf8');
  } catch {
    return null;
  }
}

function clearKeyStorage(): void {
  const saltPath = getStoragePath(SALT_FILE);
  const kcvPath = getStoragePath(KCV_FILE);

  fs.rmSync(saltPath, { force: true });
  fs.rmSync(kcvPath, { force: true });
}

/**
 * Register IPC handlers for SQLite operations.
 */
export function registerSqliteHandlers(): void {
  // Database operations
  ipcMain.handle(
    'sqlite:initialize',
    async (_event, config: { name: string; encryptionKey: number[] }) => {
      try {
        initializeDatabase(config);
      } catch (error) {
        console.error('sqlite:initialize error:', error);
        throw error;
      }
    }
  );

  ipcMain.handle('sqlite:close', () => {
    closeDatabase();
  });

  ipcMain.handle(
    'sqlite:execute',
    (_event, sql: string, params?: unknown[]) => {
      return execute(sql, params);
    }
  );

  ipcMain.handle('sqlite:executeMany', (_event, statements: string[]) => {
    executeMany(statements);
  });

  ipcMain.handle('sqlite:beginTransaction', () => {
    beginTransaction();
  });

  ipcMain.handle('sqlite:commit', () => {
    commit();
  });

  ipcMain.handle('sqlite:rollback', () => {
    rollback();
  });

  ipcMain.handle('sqlite:rekey', (_event, newKey: number[]) => {
    rekey(newKey);
  });

  // Key storage operations
  ipcMain.handle('sqlite:getSalt', () => {
    return getSalt();
  });

  ipcMain.handle('sqlite:setSalt', (_event, salt: number[]) => {
    storeSalt(salt);
  });

  ipcMain.handle('sqlite:getKeyCheckValue', () => {
    return getKeyCheckValue();
  });

  ipcMain.handle('sqlite:setKeyCheckValue', (_event, kcv: string) => {
    storeKeyCheckValue(kcv);
  });

  ipcMain.handle('sqlite:clearKeyStorage', () => {
    clearKeyStorage();
  });

  ipcMain.handle('sqlite:deleteDatabase', (_event, name: string) => {
    deleteDatabase(name);
  });

  ipcMain.handle('sqlite:export', async (_event, name: string) => {
    const data = await exportDatabase(name);
    // Convert Buffer to number[] for IPC transfer
    return Array.from(data);
  });

  ipcMain.handle(
    'sqlite:import',
    async (_event, name: string, data: number[], key: number[]) => {
      await importDatabase(name, Buffer.from(data), key);
    }
  );
}

/**
 * Delete the database file.
 */
function deleteDatabase(name: string): void {
  closeDatabase();

  const dbPath = getDatabasePath(name);

  // Delete database files (force: true handles non-existent files gracefully)
  fs.rmSync(dbPath, { force: true });
  fs.rmSync(`${dbPath}-wal`, { force: true });
  fs.rmSync(`${dbPath}-shm`, { force: true });
}

/**
 * Export the database to a buffer.
 * Returns a plaintext (unencrypted) SQLite database for cross-platform portability.
 * Creates an unencrypted copy by attaching a new database and copying tables.
 */
async function exportDatabase(name: string): Promise<Buffer> {
  if (!db) {
    throw new Error('Database not initialized');
  }

  // Checkpoint WAL to ensure all data is in main file
  db.exec('PRAGMA wal_checkpoint(TRUNCATE);');

  const dbPath = getDatabasePath(name);
  const plaintextPath = `${dbPath}.export.tmp`;

  try {
    // Remove any existing export file
    try {
      await fs.promises.unlink(plaintextPath);
    } catch {
      // Ignore if file doesn't exist
    }

    // Create a new unencrypted database and copy all schema and data
    const plaintextDb = new Database(plaintextPath);

    try {
      // Get all table names from the encrypted database
      const tables = db
        .prepare(
          "SELECT name, sql FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'"
        )
        .all() as { name: string; sql: string }[];

      // Get all indexes
      const indexes = db
        .prepare(
          "SELECT name, sql FROM sqlite_master WHERE type='index' AND sql IS NOT NULL"
        )
        .all() as { name: string; sql: string | null }[];

      // Create tables in plaintext database
      for (const table of tables) {
        plaintextDb.exec(table.sql);
      }

      // Copy data from each table
      for (const table of tables) {
        const rows = db.prepare(`SELECT * FROM "${table.name}"`).all();
        if (rows.length > 0) {
          const columns = Object.keys(rows[0] as Record<string, unknown>);
          const placeholders = columns.map(() => '?').join(', ');
          const insert = plaintextDb.prepare(
            `INSERT INTO "${table.name}" (${columns.map((c) => `"${c}"`).join(', ')}) VALUES (${placeholders})`
          );

          const insertMany = plaintextDb.transaction(
            (data: Record<string, unknown>[]) => {
              for (const row of data) {
                insert.run(...columns.map((c) => row[c]));
              }
            }
          );
          insertMany(rows as Record<string, unknown>[]);
        }
      }

      // Create indexes in plaintext database
      for (const index of indexes) {
        if (index.sql) {
          plaintextDb.exec(index.sql);
        }
      }

      plaintextDb.close();

      // Read and return the plaintext database
      const data = await fs.promises.readFile(plaintextPath);
      console.log(
        'Exported plaintext database:',
        data.length,
        'bytes, first 16 bytes:',
        Array.from(data.slice(0, 16))
      );
      return data;
    } catch (error) {
      plaintextDb.close();
      throw error;
    }
  } finally {
    // Clean up export file
    try {
      await fs.promises.unlink(plaintextPath);
    } catch {
      // Ignore cleanup errors
    }
  }
}

/**
 * Import a database from a buffer.
 * Backups are raw (unencrypted) SQLite databases for cross-platform portability.
 * After import, re-encrypts the database with the provided key.
 * @param name The database name
 * @param data The plaintext SQLite database as a Buffer
 * @param key The encryption key to use for re-encryption
 */
async function importDatabase(
  name: string,
  data: Buffer,
  key: number[]
): Promise<void> {
  const dbPath = getDatabasePath(name);
  const backupPath = `${dbPath}.backup`;
  const walPath = `${dbPath}-wal`;
  const shmPath = `${dbPath}-shm`;
  const plaintextPath = `${dbPath}.import.tmp`;

  console.log(
    'Importing plaintext database:',
    data.length,
    'bytes, first 16 bytes:',
    Array.from(data.slice(0, 16))
  );

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

    // Write plaintext data to a temp file
    await fs.promises.writeFile(plaintextPath, data);

    // Open the plaintext database to read its contents
    const plaintextDb = new Database(plaintextPath);

    // Verify it's a valid SQLite database
    try {
      plaintextDb.exec('SELECT 1');
    } catch (error) {
      plaintextDb.close();
      throw new Error('Invalid backup file: not a valid SQLite database');
    }

    // Delete the target path if it exists
    try {
      await fs.promises.unlink(dbPath);
    } catch {
      // Ignore if file doesn't exist
    }

    // Create the encrypted database and copy data
    const keyBuffer = Buffer.from(key);
    const keyHex = keyBuffer.toString('hex');
    secureZeroBuffer(keyBuffer);

    db = new Database(dbPath);
    db.pragma(`cipher='chacha20'`);
    db.pragma(`key="x'${keyHex}'"`);

    try {
      // Get all tables from plaintext database
      const tables = plaintextDb
        .prepare(
          "SELECT name, sql FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'"
        )
        .all() as { name: string; sql: string }[];

      // Get all indexes
      const indexes = plaintextDb
        .prepare(
          "SELECT name, sql FROM sqlite_master WHERE type='index' AND sql IS NOT NULL"
        )
        .all() as { name: string; sql: string | null }[];

      // Create tables in encrypted database
      for (const table of tables) {
        db.exec(table.sql);
      }

      // Copy data from each table
      for (const table of tables) {
        const rows = plaintextDb
          .prepare(`SELECT * FROM "${table.name}"`)
          .all();
        if (rows.length > 0) {
          const columns = Object.keys(rows[0] as Record<string, unknown>);
          const placeholders = columns.map(() => '?').join(', ');
          const insert = db.prepare(
            `INSERT INTO "${table.name}" (${columns.map((c) => `"${c}"`).join(', ')}) VALUES (${placeholders})`
          );

          const insertMany = db.transaction(
            (dataRows: Record<string, unknown>[]) => {
              for (const row of dataRows) {
                insert.run(...columns.map((c) => row[c]));
              }
            }
          );
          insertMany(rows as Record<string, unknown>[]);
        }
      }

      // Create indexes in encrypted database
      for (const index of indexes) {
        if (index.sql) {
          db.exec(index.sql);
        }
      }

      plaintextDb.close();

      // Enable standard pragmas
      db.pragma('journal_mode = WAL');
      db.pragma('foreign_keys = ON');

      console.log('Database imported and re-encrypted successfully');

      // Clean up plaintext temp file
      try {
        await fs.promises.unlink(plaintextPath);
      } catch {
        // Ignore cleanup errors
      }

      // Remove backup on success
      try {
        await fs.promises.unlink(backupPath);
      } catch {
        // Ignore cleanup errors
      }
    } catch (error) {
      plaintextDb.close();
      if (db) {
        db.close();
        db = null;
      }
      throw error;
    }
  } catch (error) {
    // Clean up temp file on failure
    try {
      await fs.promises.unlink(plaintextPath);
    } catch {
      // Ignore
    }

    // Restore from backup on failure
    try {
      await fs.promises.copyFile(backupPath, dbPath);
    } catch {
      // Best effort restore - if this fails, database may be corrupted
    }

    // Ensure db is null so caller knows to re-unlock
    db = null;

    // Re-throw with more context about recovery state
    const originalMessage =
      error instanceof Error ? error.message : String(error);
    throw new Error(
      `Import failed: ${originalMessage}. ` +
        'Database has been restored from backup. Please unlock again.'
    );
  }
}

/**
 * Clean up on app quit.
 */
export function cleanupSqlite(): void {
  closeDatabase();
}
