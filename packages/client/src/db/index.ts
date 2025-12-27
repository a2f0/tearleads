/**
 * Database initialization and factory.
 * Provides a unified API for SQLite across all platforms.
 */

import type { SqliteRemoteDatabase } from 'drizzle-orm/sqlite-proxy';
import { drizzle } from 'drizzle-orm/sqlite-proxy';
import type { DatabaseAdapter, PlatformInfo } from './adapters';
import { createAdapter, getPlatformInfo } from './adapters';
import { getKeyManager } from './crypto';
import * as schema from './schema';

export type Database = SqliteRemoteDatabase<typeof schema>;

let databaseInstance: Database | null = null;
let adapterInstance: DatabaseAdapter | null = null;
let platformInfoCache: PlatformInfo | null = null;

/**
 * Get the current platform info.
 */
export function getCurrentPlatform(): PlatformInfo {
  if (!platformInfoCache) {
    platformInfoCache = getPlatformInfo();
  }
  return platformInfoCache;
}

/**
 * Check if the database has been set up (has an encryption key).
 */
export async function isDatabaseSetUp(): Promise<boolean> {
  const keyManager = getKeyManager();
  return keyManager.hasExistingKey();
}

/**
 * Set up a new database with a password.
 * Creates the encryption key and initializes the database.
 */
export async function setupDatabase(password: string): Promise<Database> {
  if (databaseInstance) {
    throw new Error('Database already initialized');
  }

  const keyManager = getKeyManager();
  const encryptionKey = await keyManager.setupNewKey(password);

  return initializeDatabaseWithKey(encryptionKey);
}

/**
 * Unlock an existing database with a password.
 * @param persistSession If true, persist the key for session restoration on reload (web only)
 */
export async function unlockDatabase(
  password: string,
  persistSession = false
): Promise<Database | null> {
  if (databaseInstance) {
    return databaseInstance;
  }

  const keyManager = getKeyManager();
  const encryptionKey = await keyManager.unlockWithPassword(password);

  if (!encryptionKey) {
    return null; // Wrong password
  }

  const db = await initializeDatabaseWithKey(encryptionKey);

  // Persist session if requested (web only)
  if (persistSession) {
    await keyManager.persistSession();
  }

  return db;
}

/**
 * Check if there's a persisted session available (web only).
 */
export async function hasPersistedSession(): Promise<boolean> {
  const keyManager = getKeyManager();
  return keyManager.hasPersistedSession();
}

/**
 * Restore the database from a persisted session (web only).
 * Returns the database if successful, null if no persisted session or restoration failed.
 */
export async function restoreDatabaseSession(): Promise<Database | null> {
  if (databaseInstance) {
    return databaseInstance;
  }

  const keyManager = getKeyManager();
  const encryptionKey = await keyManager.restoreSession();

  if (!encryptionKey) {
    return null;
  }

  try {
    return await initializeDatabaseWithKey(encryptionKey);
  } catch (err) {
    console.error('Failed to restore database session:', err);
    // Clear the invalid session
    await keyManager.clearPersistedSession();
    keyManager.clearKey();
    return null;
  }
}

/**
 * Clear any persisted session data (web only).
 */
export async function clearPersistedSession(): Promise<void> {
  const keyManager = getKeyManager();
  await keyManager.clearPersistedSession();
}

/**
 * Initialize the database with an encryption key.
 */
async function initializeDatabaseWithKey(
  encryptionKey: Uint8Array
): Promise<Database> {
  const platformInfo = getCurrentPlatform();

  // Reuse existing adapter if available (keeps worker/WASM memory alive on web)
  const adapter = adapterInstance ?? (await createAdapter(platformInfo));

  await adapter.initialize({
    name: 'rapid',
    encryptionKey,
    location: platformInfo.platform === 'ios' ? 'library' : 'default'
  });

  adapterInstance = adapter;

  // Create Drizzle instance with the sqlite-proxy driver
  // The adapters return { rows: any[] } for all methods as expected by Drizzle
  const connection = adapter.getConnection() as (
    sql: string,
    params: unknown[],
    method: 'all' | 'get' | 'run' | 'values'
  ) => Promise<{ rows: unknown[] }>;

  databaseInstance = drizzle(connection, { schema });

  // Run migrations
  await runMigrations();

  return databaseInstance;
}

/**
 * Run database migrations.
 */
async function runMigrations(): Promise<void> {
  if (!adapterInstance) {
    throw new Error('Database not initialized');
  }

  // Create schema tables if they don't exist
  const statements = [
    `CREATE TABLE IF NOT EXISTS "sync_metadata" (
      "id" TEXT PRIMARY KEY NOT NULL,
      "entity_type" TEXT NOT NULL,
      "entity_id" TEXT NOT NULL,
      "version" INTEGER DEFAULT 0 NOT NULL,
      "last_modified" INTEGER NOT NULL,
      "sync_status" TEXT DEFAULT 'pending' NOT NULL,
      "deleted" INTEGER DEFAULT 0 NOT NULL
    )`,
    `CREATE INDEX IF NOT EXISTS "entity_idx" ON "sync_metadata" ("entity_type", "entity_id")`,
    `CREATE INDEX IF NOT EXISTS "sync_status_idx" ON "sync_metadata" ("sync_status")`,
    `CREATE TABLE IF NOT EXISTS "user_settings" (
      "key" TEXT PRIMARY KEY NOT NULL,
      "value" TEXT,
      "updated_at" INTEGER NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS "schema_migrations" (
      "version" INTEGER PRIMARY KEY NOT NULL,
      "applied_at" INTEGER NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS "secrets" (
      "key" TEXT PRIMARY KEY NOT NULL,
      "encrypted_value" TEXT NOT NULL,
      "created_at" INTEGER NOT NULL,
      "updated_at" INTEGER NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS "files" (
      "id" TEXT PRIMARY KEY NOT NULL,
      "name" TEXT NOT NULL,
      "size" INTEGER NOT NULL,
      "mime_type" TEXT NOT NULL,
      "upload_date" INTEGER NOT NULL,
      "content_hash" TEXT NOT NULL,
      "storage_path" TEXT NOT NULL,
      "deleted" INTEGER DEFAULT 0 NOT NULL
    )`,
    `CREATE INDEX IF NOT EXISTS "files_content_hash_idx" ON "files" ("content_hash")`,
    `CREATE INDEX IF NOT EXISTS "files_upload_date_idx" ON "files" ("upload_date")`
  ];

  await adapterInstance.executeMany(statements);
}

/**
 * Get the current database instance.
 * Throws if the database is not initialized.
 */
export function getDatabase(): Database {
  if (!databaseInstance) {
    throw new Error(
      'Database not initialized. Call setupDatabase or unlockDatabase first.'
    );
  }
  return databaseInstance;
}

/**
 * Get the database adapter instance.
 */
export function getDatabaseAdapter(): DatabaseAdapter {
  if (!adapterInstance) {
    throw new Error('Database not initialized');
  }
  return adapterInstance;
}

/**
 * Close the database connection.
 * Note: On web, the adapter is preserved to keep the worker/WASM memory alive.
 * This allows data to persist across lock/unlock cycles within a session.
 */
export async function closeDatabase(): Promise<void> {
  if (adapterInstance) {
    await adapterInstance.close();
    // Don't null out the adapter - keep it for potential unlock
    // The worker stays alive with the encrypted file in WASM VFS
  }
  databaseInstance = null;

  // Clear the encryption key from memory
  const keyManager = getKeyManager();
  keyManager.clearKey();
}

/**
 * Change the database password.
 */
export async function changePassword(
  oldPassword: string,
  newPassword: string
): Promise<boolean> {
  if (!adapterInstance) {
    throw new Error('Database not initialized');
  }

  const keyManager = getKeyManager();
  const keys = await keyManager.changePassword(oldPassword, newPassword);

  if (!keys) {
    return false; // Wrong old password
  }

  // Re-key the database with the new key
  // Pass oldKey for Capacitor which requires both keys for changeEncryptionSecret
  await adapterInstance.rekeyDatabase(keys.newKey, keys.oldKey);

  return true;
}

/**
 * Reset the database (for testing or complete wipe).
 */
export async function resetDatabase(): Promise<void> {
  // Store adapter reference before closing
  const adapter = adapterInstance;

  await closeDatabase();

  // Delete the database file if adapter supports it
  if (adapter?.deleteDatabase) {
    await adapter.deleteDatabase('rapid');
  } else {
    // For Electron, try to delete the database file directly
    // even if no adapter was initialized
    const platformInfo = getCurrentPlatform();
    if (platformInfo.platform === 'electron') {
      try {
        if (window.electron?.sqlite?.deleteDatabase) {
          await window.electron.sqlite.deleteDatabase('rapid');
        }
      } catch {
        // Ignore errors if the file doesn't exist
      }
    }
  }

  // Terminate the worker to destroy WASM memory (web platform)
  if (
    adapter &&
    'terminate' in adapter &&
    typeof adapter.terminate === 'function'
  ) {
    adapter.terminate();
  }
  adapterInstance = null;

  const keyManager = getKeyManager();
  // Clear any persisted session before full reset
  await keyManager.clearPersistedSession();
  await keyManager.reset();
}

/**
 * Export the database to a byte array for backup.
 * The returned data is the raw encrypted database file.
 * @returns The encrypted database as a Uint8Array
 */
export async function exportDatabase(): Promise<Uint8Array> {
  if (!adapterInstance) {
    throw new Error('Database not initialized');
  }

  if (!adapterInstance.exportDatabase) {
    throw new Error('Export not supported on this platform');
  }

  return adapterInstance.exportDatabase();
}

/**
 * Import a database from a byte array backup.
 * Replaces the current database with the provided backup data.
 * @param data The encrypted database backup as a Uint8Array
 */
export async function importDatabase(data: Uint8Array): Promise<void> {
  if (!adapterInstance) {
    throw new Error('Database not initialized');
  }

  if (!adapterInstance.importDatabase) {
    throw new Error('Import not supported on this platform');
  }

  // Get the current encryption key for adapters that need it (e.g., Electron)
  const keyManager = getKeyManager();
  const encryptionKey = keyManager.getCurrentKey();

  await adapterInstance.importDatabase(data, encryptionKey ?? undefined);

  // Re-run migrations in case the backup is from an older version
  await runMigrations();
}

export type { DatabaseAdapter, PlatformInfo } from './adapters';
// Re-export schema and types
export * from './schema';
