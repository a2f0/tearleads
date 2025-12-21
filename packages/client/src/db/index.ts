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
 */
export async function unlockDatabase(
  password: string
): Promise<Database | null> {
  if (databaseInstance) {
    return databaseInstance;
  }

  const keyManager = getKeyManager();
  const encryptionKey = await keyManager.unlockWithPassword(password);

  if (!encryptionKey) {
    return null; // Wrong password
  }

  return initializeDatabaseWithKey(encryptionKey);
}

/**
 * Initialize the database with an encryption key.
 */
async function initializeDatabaseWithKey(
  encryptionKey: Uint8Array
): Promise<Database> {
  const platformInfo = getCurrentPlatform();
  const adapter = await createAdapter(platformInfo);

  await adapter.initialize({
    name: 'rapid',
    encryptionKey,
    location: platformInfo.platform === 'ios' ? 'library' : 'default'
  });

  adapterInstance = adapter;

  // Create Drizzle instance with the sqlite-proxy driver
  // The connection function needs to handle 'values' method for Drizzle compatibility
  const rawConnection = adapter.getConnection() as (
    sql: string,
    params: unknown[],
    method: 'all' | 'get' | 'run'
  ) => Promise<{ rows: unknown[] }>;

  // Wrap to handle the 'values' method that Drizzle might use
  const connection = async (
    sql: string,
    params: unknown[],
    method: 'all' | 'get' | 'run' | 'values'
  ): Promise<{ rows: unknown[] }> => {
    // 'values' method is used for returning raw values without column names
    // We map it to 'all' and let Drizzle handle the transformation
    const effectiveMethod = method === 'values' ? 'all' : method;
    const result = await rawConnection(sql, params, effectiveMethod);
    // Ensure we always return the expected format
    if (Array.isArray(result)) {
      return { rows: result };
    }
    return result;
  };

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
    )`
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
 */
export async function closeDatabase(): Promise<void> {
  if (adapterInstance) {
    await adapterInstance.close();
    adapterInstance = null;
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
  await adapterInstance.rekeyDatabase(keys.newKey);

  return true;
}

/**
 * Reset the database (for testing or complete wipe).
 */
export async function resetDatabase(): Promise<void> {
  await closeDatabase();

  const keyManager = getKeyManager();
  await keyManager.reset();
}

export type { DatabaseAdapter, PlatformInfo } from './adapters';
// Re-export schema and types
export * from './schema';
