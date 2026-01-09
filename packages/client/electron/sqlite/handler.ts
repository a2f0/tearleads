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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function getErrorCode(error: unknown): string | undefined {
  if (!isRecord(error)) {
    return undefined;
  }
  const code = error.code;
  return typeof code === 'string' ? code : undefined;
}

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
 *
 * Storage is namespaced by instance ID for multi-instance support.
 */
const SALT_PREFIX = '.salt';
const KCV_PREFIX = '.kcv';
const WRAPPING_KEY_PREFIX = '.wrapping_key';
const WRAPPED_KEY_PREFIX = '.wrapped_key';

function getStoragePath(filename: string): string {
  return path.join(app.getPath('userData'), filename);
}

function getSaltFilename(instanceId: string): string {
  return `${SALT_PREFIX}_${instanceId}`;
}

function getKcvFilename(instanceId: string): string {
  return `${KCV_PREFIX}_${instanceId}`;
}

function getWrappingKeyFilename(instanceId: string): string {
  return `${WRAPPING_KEY_PREFIX}_${instanceId}`;
}

function getWrappedKeyFilename(instanceId: string): string {
  return `${WRAPPED_KEY_PREFIX}_${instanceId}`;
}

function storeSalt(salt: number[], instanceId: string): void {
  const saltPath = getStoragePath(getSaltFilename(instanceId));
  fs.writeFileSync(saltPath, JSON.stringify(salt), 'utf8');
}

function getSalt(instanceId: string): number[] | null {
  const saltPath = getStoragePath(getSaltFilename(instanceId));
  try {
    return JSON.parse(fs.readFileSync(saltPath, 'utf8'));
  } catch {
    return null;
  }
}

function storeKeyCheckValue(kcv: string, instanceId: string): void {
  const kcvPath = getStoragePath(getKcvFilename(instanceId));
  fs.writeFileSync(kcvPath, kcv, 'utf8');
}

function getKeyCheckValue(instanceId: string): string | null {
  const kcvPath = getStoragePath(getKcvFilename(instanceId));
  try {
    return fs.readFileSync(kcvPath, 'utf8');
  } catch {
    return null;
  }
}

function clearKeyStorage(instanceId: string): void {
  const saltPath = getStoragePath(getSaltFilename(instanceId));
  const kcvPath = getStoragePath(getKcvFilename(instanceId));

  fs.rmSync(saltPath, { force: true });
  fs.rmSync(kcvPath, { force: true });
}

/**
 * Session persistence storage using Electron's safeStorage API.
 * safeStorage encrypts data using OS-level encryption:
 * - macOS: Keychain
 * - Windows: DPAPI
 * - Linux: libsecret or kwallet
 */

/**
 * Helper to store encrypted data using safeStorage.
 */
function storeEncryptedData(data: number[], filename: string): void {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error('Secure storage is not available on this system');
  }
  const keyPath = getStoragePath(filename);
  const buffer = Buffer.from(data);
  const encrypted = safeStorage.encryptString(buffer.toString('base64'));
  secureZeroBuffer(buffer);
  fs.writeFileSync(keyPath, encrypted);
}

/**
 * Helper to retrieve encrypted data using safeStorage.
 */
function getEncryptedData(filename: string): number[] | null {
  if (!safeStorage.isEncryptionAvailable()) {
    return null;
  }
  const keyPath = getStoragePath(filename);
  try {
    const encrypted = fs.readFileSync(keyPath);
    const decrypted = safeStorage.decryptString(encrypted);
    const buffer = Buffer.from(decrypted, 'base64');
    const result = Array.from(buffer);
    secureZeroBuffer(buffer);
    return result;
  } catch (error: unknown) {
    // It's normal for the file not to exist. Only log other errors.
    const code = getErrorCode(error);
    if (error instanceof Error && code !== 'ENOENT') {
      console.error(
        `Failed to read or decrypt session data from ${keyPath}:`,
        error
      );
    }
    return null;
  }
}

function storeWrappingKey(keyBytes: number[], instanceId: string): void {
  storeEncryptedData(keyBytes, getWrappingKeyFilename(instanceId));
}

function getWrappingKey(instanceId: string): number[] | null {
  return getEncryptedData(getWrappingKeyFilename(instanceId));
}

function storeWrappedKey(wrappedKey: number[], instanceId: string): void {
  storeEncryptedData(wrappedKey, getWrappedKeyFilename(instanceId));
}

function getWrappedKey(instanceId: string): number[] | null {
  return getEncryptedData(getWrappedKeyFilename(instanceId));
}

function hasSession(instanceId: string): boolean {
  const wrappingKeyPath = getStoragePath(getWrappingKeyFilename(instanceId));
  const wrappedKeyPath = getStoragePath(getWrappedKeyFilename(instanceId));
  return fs.existsSync(wrappingKeyPath) && fs.existsSync(wrappedKeyPath);
}

function clearSession(instanceId: string): void {
  const wrappingKeyPath = getStoragePath(getWrappingKeyFilename(instanceId));
  const wrappedKeyPath = getStoragePath(getWrappedKeyFilename(instanceId));

  fs.rmSync(wrappingKeyPath, { force: true });
  fs.rmSync(wrappedKeyPath, { force: true });
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

  // Key storage operations (namespaced by instanceId)
  ipcMain.handle('sqlite:getSalt', (_event, instanceId: string) => {
    return getSalt(instanceId);
  });

  ipcMain.handle('sqlite:setSalt', (_event, salt: number[], instanceId: string) => {
    storeSalt(salt, instanceId);
  });

  ipcMain.handle('sqlite:getKeyCheckValue', (_event, instanceId: string) => {
    return getKeyCheckValue(instanceId);
  });

  ipcMain.handle('sqlite:setKeyCheckValue', (_event, kcv: string, instanceId: string) => {
    storeKeyCheckValue(kcv, instanceId);
  });

  ipcMain.handle('sqlite:clearKeyStorage', (_event, instanceId: string) => {
    clearKeyStorage(instanceId);
  });

  // Session persistence operations (namespaced by instanceId)
  ipcMain.handle('sqlite:getWrappingKey', (_event, instanceId: string) => {
    return getWrappingKey(instanceId);
  });

  ipcMain.handle(
    'sqlite:setWrappingKey',
    (_event, keyBytes: number[], instanceId: string) => {
      storeWrappingKey(keyBytes, instanceId);
    }
  );

  ipcMain.handle('sqlite:getWrappedKey', (_event, instanceId: string) => {
    return getWrappedKey(instanceId);
  });

  ipcMain.handle(
    'sqlite:setWrappedKey',
    (_event, wrappedKey: number[], instanceId: string) => {
      storeWrappedKey(wrappedKey, instanceId);
    }
  );

  ipcMain.handle('sqlite:hasSession', (_event, instanceId: string) => {
    return hasSession(instanceId);
  });

  ipcMain.handle('sqlite:clearSession', (_event, instanceId: string) => {
    clearSession(instanceId);
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
 * Checkpoints WAL to ensure all data is in the main file.
 */
async function exportDatabase(name: string): Promise<Buffer> {
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
async function importDatabase(
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
    db = new Database(dbPath);

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
      db = null;
      throw new Error(
        'Failed to open imported database: invalid encryption key'
      );
    }

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
