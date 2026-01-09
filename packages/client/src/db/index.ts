/**
 * Database initialization and factory.
 * Provides a unified API for SQLite across all platforms.
 * Supports multi-instance with namespaced database files.
 */

import { isRecord } from '@rapid/shared';
import type { SqliteRemoteDatabase } from 'drizzle-orm/sqlite-proxy';
import { drizzle } from 'drizzle-orm/sqlite-proxy';
import type { DatabaseAdapter, PlatformInfo } from './adapters';
import { createAdapter, getPlatformInfo } from './adapters';
import { logEvent } from './analytics';
import { getKeyManagerForInstance, setCurrentInstanceId } from './crypto';
import * as schema from './schema';

export type Database = SqliteRemoteDatabase<typeof schema>;

let databaseInstance: Database | null = null;
let adapterInstance: DatabaseAdapter | null = null;
let platformInfoCache: PlatformInfo | null = null;
let currentInstanceId: string | null = null;

/**
 * Get the database name for an instance.
 */
function getDatabaseName(instanceId: string): string {
  return `rapid-${instanceId}`;
}

/**
 * Get the current instance ID.
 */
export function getCurrentInstanceId(): string | null {
  return currentInstanceId;
}

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
 * @param instanceId The instance to check
 */
export async function isDatabaseSetUp(instanceId: string): Promise<boolean> {
  const keyManager = getKeyManagerForInstance(instanceId);
  return keyManager.hasExistingKey();
}

/**
 * Set up a new database with a password.
 * Creates the encryption key and initializes the database.
 * @param password The encryption password
 * @param instanceId The instance ID to set up
 */
export async function setupDatabase(
  password: string,
  instanceId: string
): Promise<Database> {
  if (databaseInstance && currentInstanceId === instanceId) {
    throw new Error('Database already initialized for this instance');
  }

  // Close existing database if switching instances
  if (databaseInstance && currentInstanceId !== instanceId) {
    await closeDatabase();
  }

  const startTime = performance.now();

  // Set current instance
  currentInstanceId = instanceId;
  setCurrentInstanceId(instanceId);

  const keyManager = getKeyManagerForInstance(instanceId);
  const encryptionKey = await keyManager.setupNewKey(password);

  const db = await initializeDatabaseWithKey(encryptionKey, instanceId);

  // Log the setup event
  const durationMs = performance.now() - startTime;
  try {
    await logEvent(db, 'db_setup', durationMs, true);
  } catch (err) {
    // Don't let logging errors affect the main operation
    console.warn('Failed to log db_setup analytics event:', err);
  }

  return db;
}

export interface UnlockResult {
  db: Database;
  sessionPersisted: boolean;
}

/**
 * Unlock an existing database with a password.
 * @param password The encryption password
 * @param instanceId The instance ID to unlock
 * @param persistSession If true, persist the key for session restoration on reload (web only)
 * @returns Object with db instance and whether session was persisted, or null if wrong password
 */
export async function unlockDatabase(
  password: string,
  instanceId: string,
  persistSession = false
): Promise<UnlockResult | null> {
  const keyManager = getKeyManagerForInstance(instanceId);

  if (databaseInstance && currentInstanceId === instanceId) {
    return {
      db: databaseInstance,
      sessionPersisted: await keyManager.hasPersistedSession()
    };
  }

  // Close existing database if switching instances
  if (databaseInstance && currentInstanceId !== instanceId) {
    await closeDatabase();
  }

  const startTime = performance.now();

  // Set current instance
  currentInstanceId = instanceId;
  setCurrentInstanceId(instanceId);

  const encryptionKey = await keyManager.unlockWithPassword(password);

  if (!encryptionKey) {
    return null; // Wrong password
  }

  const db = await initializeDatabaseWithKey(encryptionKey, instanceId);

  // Log the unlock event
  const durationMs = performance.now() - startTime;
  try {
    await logEvent(db, 'db_unlock', durationMs, true);
  } catch (err) {
    // Don't let logging errors affect the main operation
    console.warn('Failed to log db_unlock analytics event:', err);
  }

  // Persist session if requested (web only)
  let sessionPersisted = false;
  if (persistSession) {
    sessionPersisted = await keyManager.persistSession();
  }

  return { db, sessionPersisted };
}

/**
 * Check if there's a persisted session available (web only).
 * @param instanceId The instance to check
 */
export async function hasPersistedSession(
  instanceId: string
): Promise<boolean> {
  const keyManager = getKeyManagerForInstance(instanceId);
  return keyManager.hasPersistedSession();
}

/**
 * Restore the database from a persisted session (web only).
 * Returns the database if successful, null if no persisted session or restoration failed.
 * @param instanceId The instance ID to restore
 */
export async function restoreDatabaseSession(
  instanceId: string
): Promise<Database | null> {
  if (databaseInstance && currentInstanceId === instanceId) {
    return databaseInstance;
  }

  // Close existing database if switching instances
  if (databaseInstance && currentInstanceId !== instanceId) {
    await closeDatabase();
  }

  const startTime = performance.now();

  // Set current instance
  currentInstanceId = instanceId;
  setCurrentInstanceId(instanceId);

  const keyManager = getKeyManagerForInstance(instanceId);
  const encryptionKey = await keyManager.restoreSession();

  if (!encryptionKey) {
    return null;
  }

  try {
    const db = await initializeDatabaseWithKey(encryptionKey, instanceId);

    // Log the session restore event
    const durationMs = performance.now() - startTime;
    try {
      await logEvent(db, 'db_session_restore', durationMs, true);
    } catch (err) {
      // Don't let logging errors affect the main operation
      console.warn('Failed to log db_session_restore analytics event:', err);
    }

    return db;
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
 * @param instanceId The instance to clear session for
 */
export async function clearPersistedSession(instanceId: string): Promise<void> {
  const keyManager = getKeyManagerForInstance(instanceId);
  await keyManager.clearPersistedSession();
}

/**
 * Initialize the database with an encryption key.
 * @param encryptionKey The encryption key
 * @param instanceId The instance ID for database naming
 */
async function initializeDatabaseWithKey(
  encryptionKey: Uint8Array,
  instanceId: string
): Promise<Database> {
  const platformInfo = getCurrentPlatform();

  // Reuse existing adapter if available (keeps worker/WASM memory alive on web)
  const adapter = adapterInstance ?? (await createAdapter(platformInfo));

  const dbName = getDatabaseName(instanceId);

  await adapter.initialize({
    name: dbName,
    encryptionKey,
    location: platformInfo.platform === 'ios' ? 'library' : 'default'
  });

  adapterInstance = adapter;

  // Create Drizzle instance with the sqlite-proxy driver
  // The adapters return { rows: any[] } for all methods as expected by Drizzle
  const connection = adapter.getConnection();
  if (!isDrizzleConnection(connection)) {
    throw new Error('Database adapter returned invalid connection');
  }

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
      "thumbnail_path" TEXT,
      "deleted" INTEGER DEFAULT 0 NOT NULL
    )`,
    `CREATE INDEX IF NOT EXISTS "files_content_hash_idx" ON "files" ("content_hash")`,
    `CREATE INDEX IF NOT EXISTS "files_upload_date_idx" ON "files" ("upload_date")`,
    `CREATE TABLE IF NOT EXISTS "contacts" (
      "id" TEXT PRIMARY KEY NOT NULL,
      "first_name" TEXT NOT NULL,
      "last_name" TEXT,
      "birthday" TEXT,
      "created_at" INTEGER NOT NULL,
      "updated_at" INTEGER NOT NULL,
      "deleted" INTEGER DEFAULT 0 NOT NULL
    )`,
    `CREATE INDEX IF NOT EXISTS "contacts_first_name_idx" ON "contacts" ("first_name")`,
    `CREATE TABLE IF NOT EXISTS "contact_phones" (
      "id" TEXT PRIMARY KEY NOT NULL,
      "contact_id" TEXT NOT NULL,
      "phone_number" TEXT NOT NULL,
      "label" TEXT,
      "is_primary" INTEGER DEFAULT 0 NOT NULL,
      FOREIGN KEY("contact_id") REFERENCES "contacts"("id") ON DELETE CASCADE
    )`,
    `CREATE INDEX IF NOT EXISTS "contact_phones_contact_idx" ON "contact_phones" ("contact_id")`,
    `CREATE TABLE IF NOT EXISTS "contact_emails" (
      "id" TEXT PRIMARY KEY NOT NULL,
      "contact_id" TEXT NOT NULL,
      "email" TEXT NOT NULL,
      "label" TEXT,
      "is_primary" INTEGER DEFAULT 0 NOT NULL,
      FOREIGN KEY("contact_id") REFERENCES "contacts"("id") ON DELETE CASCADE
    )`,
    `CREATE INDEX IF NOT EXISTS "contact_emails_contact_idx" ON "contact_emails" ("contact_id")`,
    `CREATE INDEX IF NOT EXISTS "contact_emails_email_idx" ON "contact_emails" ("email")`,
    `CREATE TABLE IF NOT EXISTS "analytics_events" (
      "id" TEXT PRIMARY KEY NOT NULL,
      "event_name" TEXT NOT NULL,
      "duration_ms" INTEGER NOT NULL,
      "success" INTEGER NOT NULL,
      "timestamp" INTEGER NOT NULL
    )`,
    `CREATE INDEX IF NOT EXISTS "analytics_events_timestamp_idx" ON "analytics_events" ("timestamp")`
  ];

  await adapterInstance.executeMany(statements);

  // Helper to add a column if it doesn't exist
  async function addColumnIfNotExists(
    tableName: string,
    columnName: string,
    columnDefinition: string
  ): Promise<void> {
    try {
      const info = await adapterInstance?.execute(
        `PRAGMA table_info("${tableName}")`
      );
      const columnExists = info?.rows?.some(
        (col) => isRecord(col) && col['name'] === columnName
      );
      if (!columnExists) {
        await adapterInstance?.execute(
          `ALTER TABLE "${tableName}" ADD COLUMN "${columnName}" ${columnDefinition}`
        );
      }
    } catch {
      // PRAGMA not supported or column already exists, ignore
    }
  }

  // Migrations for existing databases
  await addColumnIfNotExists('contacts', 'last_name', 'TEXT');
  await addColumnIfNotExists('files', 'thumbnail_path', 'TEXT');
}

type DrizzleConnection = (
  sql: string,
  params: unknown[],
  method: 'all' | 'get' | 'run' | 'values'
) => Promise<{ rows: unknown[] }>;

function isDrizzleConnection(value: unknown): value is DrizzleConnection {
  return typeof value === 'function';
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

  // Clear the encryption key from memory for current instance
  if (currentInstanceId) {
    const keyManager = getKeyManagerForInstance(currentInstanceId);
    keyManager.clearKey();
  }
}

/**
 * Change the database password.
 */
export async function changePassword(
  oldPassword: string,
  newPassword: string
): Promise<boolean> {
  if (!adapterInstance || !databaseInstance || !currentInstanceId) {
    throw new Error('Database not initialized');
  }

  const startTime = performance.now();

  const keyManager = getKeyManagerForInstance(currentInstanceId);
  const keys = await keyManager.changePassword(oldPassword, newPassword);

  if (!keys) {
    return false; // Wrong old password
  }

  // Re-key the database with the new key
  // Pass oldKey for Capacitor which requires both keys for changeEncryptionSecret
  await adapterInstance.rekeyDatabase(keys.newKey, keys.oldKey);

  // Log the password change event
  const durationMs = performance.now() - startTime;
  try {
    await logEvent(databaseInstance, 'db_password_change', durationMs, true);
  } catch (err) {
    // Don't let logging errors affect the main operation
    console.warn('Failed to log db_password_change analytics event:', err);
  }

  return true;
}

/**
 * Reset a specific database instance (for testing or complete wipe).
 * @param instanceId The instance ID to reset
 */
export async function resetDatabase(instanceId: string): Promise<void> {
  // Store adapter reference before closing
  const adapter = adapterInstance;

  // Only close if this is the current instance
  if (currentInstanceId === instanceId) {
    await closeDatabase();
    currentInstanceId = null;
    setCurrentInstanceId(null);
  }

  const dbName = getDatabaseName(instanceId);

  // Delete the database file if adapter supports it
  if (adapter?.deleteDatabase) {
    await adapter.deleteDatabase(dbName);
  } else {
    // For Electron, try to delete the database file directly
    // even if no adapter was initialized
    const platformInfo = getCurrentPlatform();
    if (platformInfo.platform === 'electron') {
      try {
        if (window.electron?.sqlite?.deleteDatabase) {
          await window.electron.sqlite.deleteDatabase(dbName);
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

  // Always clear the adapter instance on reset
  adapterInstance = null;

  const keyManager = getKeyManagerForInstance(instanceId);
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
  if (!adapterInstance || !currentInstanceId) {
    throw new Error('Database not initialized');
  }

  if (!adapterInstance.importDatabase) {
    throw new Error('Import not supported on this platform');
  }

  // Get the current encryption key for adapters that need it (e.g., Electron)
  const keyManager = getKeyManagerForInstance(currentInstanceId);
  const encryptionKey = keyManager.getCurrentKey();

  await adapterInstance.importDatabase(data, encryptionKey ?? undefined);

  // Re-run migrations in case the backup is from an older version
  await runMigrations();
}

export type { DatabaseAdapter, PlatformInfo } from './adapters';
// Re-export schema and types
export * from './schema';
