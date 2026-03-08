import { setAnalyticsAdapter } from '@tearleads/analytics/analyticsState';
import type { Database } from '@tearleads/db/sqlite';
import { schema } from '@tearleads/db/sqlite';
import { drizzle } from 'drizzle-orm/sqlite-proxy';
import { databaseSetupProgressStore } from '@/stores/databaseSetupProgressStore';
import { logStore } from '@/stores/logStore';
import type { PlatformInfo } from './adapters';
import { createAdapter, getPlatformInfo } from './adapters';
import { logEvent } from './analytics';
import { getKeyManagerForInstance, setCurrentInstanceId } from './crypto';
import {
  closeDatabaseForInstance,
  markDatabaseServicesUnavailable,
  runWithDatabaseLifecycleLock
} from './lifecycleCoordinator';
import { runMigrations } from './migrations';
import {
  _getAdapterInstance,
  _getDatabaseInstance,
  _setAdapterInstance,
  _setDatabaseInstance,
  getDatabase,
  getDatabaseAdapter,
  isDatabaseInitialized
} from './state';

export type { Database };
export { getDatabase, getDatabaseAdapter, isDatabaseInitialized };

let platformInfoCache: PlatformInfo | null = null;
let currentInstanceId: string | null = null;

function getDatabaseName(instanceId: string): string {
  return `tearleads-${instanceId}`;
}

export function getCurrentInstanceId(): string | null {
  return currentInstanceId;
}

export function getCurrentPlatform(): PlatformInfo {
  if (!platformInfoCache) {
    platformInfoCache = getPlatformInfo();
  }
  return platformInfoCache;
}

export async function isDatabaseSetUp(instanceId: string): Promise<boolean> {
  const keyManager = getKeyManagerForInstance(instanceId);
  return keyManager.hasExistingKey();
}

export async function setupDatabase(
  password: string,
  instanceId: string
): Promise<Database> {
  return runWithDatabaseLifecycleLock(async () => {
    const dbInstance = _getDatabaseInstance();
    if (dbInstance && currentInstanceId === instanceId) {
      throw new Error('Database already initialized for this instance');
    }

    if (dbInstance && currentInstanceId !== instanceId) {
      await closeDatabaseForInstance(currentInstanceId);
    }

    const startTime = performance.now();

    currentInstanceId = instanceId;
    setCurrentInstanceId(instanceId);

    const keyManager = getKeyManagerForInstance(instanceId);
    const encryptionKey = await keyManager.setupNewKey(password);

    const db = await initializeDatabaseWithKey(encryptionKey, instanceId);

    const durationMs = performance.now() - startTime;
    try {
      await logEvent(db, 'db_setup', durationMs, true);
    } catch (err) {
      console.warn('Failed to log db_setup analytics event:', err);
    }

    return db;
  });
}

export async function autoInitializeDatabase(
  instanceId: string
): Promise<Database> {
  return runWithDatabaseLifecycleLock(async () => {
    const dbInstance = _getDatabaseInstance();
    if (dbInstance && currentInstanceId === instanceId) {
      return dbInstance;
    }

    if (dbInstance && currentInstanceId !== instanceId) {
      await closeDatabaseForInstance(currentInstanceId);
    }

    currentInstanceId = instanceId;
    setCurrentInstanceId(instanceId);

    const keyManager = getKeyManagerForInstance(instanceId);
    const encryptionKey = await keyManager.setupAutoKey();
    const db = await initializeDatabaseWithKey(encryptionKey, instanceId);
    const persisted = await keyManager.persistSession();
    if (!persisted) {
      console.warn(
        `Failed to persist auto-initialized session for instance ${instanceId}`
      );
    }

    return db;
  });
}

interface UnlockResult {
  db: Database;
  sessionPersisted: boolean;
}

export async function unlockDatabase(
  password: string,
  instanceId: string,
  persistSession = false
): Promise<UnlockResult | null> {
  return runWithDatabaseLifecycleLock(async () => {
    const keyManager = getKeyManagerForInstance(instanceId);

    const dbInstance = _getDatabaseInstance();
    if (dbInstance && currentInstanceId === instanceId) {
      return {
        db: dbInstance,
        sessionPersisted: await keyManager.hasPersistedSession()
      };
    }

    if (dbInstance && currentInstanceId !== instanceId) {
      await closeDatabaseForInstance(currentInstanceId);
    }

    const startTime = performance.now();

    currentInstanceId = instanceId;
    setCurrentInstanceId(instanceId);

    const encryptionKey = await keyManager.unlockWithPassword(password);

    if (!encryptionKey) {
      return null;
    }

    const db = await initializeDatabaseWithKey(encryptionKey, instanceId);

    const durationMs = performance.now() - startTime;
    try {
      await logEvent(db, 'db_unlock', durationMs, true);
    } catch (err) {
      console.warn('Failed to log db_unlock analytics event:', err);
    }

    let sessionPersisted = false;
    if (persistSession) {
      sessionPersisted = await keyManager.persistSession();
    }

    return { db, sessionPersisted };
  });
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
  return runWithDatabaseLifecycleLock(async () => {
    const dbInstance = _getDatabaseInstance();
    if (dbInstance && currentInstanceId === instanceId) {
      return dbInstance;
    }

    // Close existing database if switching instances
    if (dbInstance && currentInstanceId !== instanceId) {
      await closeDatabaseForInstance(currentInstanceId);
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
  });
}

/**
 * Persist the current session for restoration on reload.
 * @param instanceId The instance to persist session for
 */
export async function persistDatabaseSession(
  instanceId: string
): Promise<boolean> {
  const keyManager = getKeyManagerForInstance(instanceId);
  return keyManager.persistSession();
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
 * Set a password protector for the currently active database key.
 * Returns false when no active key is available.
 */
export async function setDatabasePassword(
  password: string,
  instanceId: string
): Promise<boolean> {
  const normalizedPassword = password.trim();
  if (!normalizedPassword) {
    return false;
  }

  const keyManager = getKeyManagerForInstance(instanceId);
  let currentKey = keyManager.getCurrentKey();
  if (!currentKey) {
    const restored = await keyManager.restoreSession();
    if (!restored) {
      return false;
    }
    currentKey = restored;
  }

  if (!currentKey) {
    return false;
  }

  await keyManager.setPasswordForCurrentKey(normalizedPassword);
  return true;
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

  databaseSetupProgressStore.update('Opening encrypted database...', 70);

  // Reuse existing adapter if available (keeps worker/WASM memory alive on web)
  const adapterStart = performance.now();
  const adapter = _getAdapterInstance() ?? (await createAdapter(platformInfo));

  const dbName = getDatabaseName(instanceId);

  await adapter.initialize({
    name: dbName,
    encryptionKey,
    location: platformInfo.platform === 'ios' ? 'library' : 'default'
  });
  logStore.debug(
    `[db] adapter.initialize: ${(performance.now() - adapterStart).toFixed(1)}ms`
  );

  _setAdapterInstance(adapter);
  setAnalyticsAdapter(adapter);

  // Create Drizzle instance with the sqlite-proxy driver
  // The adapters return { rows: unknown[] } for all methods as expected by Drizzle
  const connection = adapter.getConnection();
  const db = drizzle(connection, { schema });
  _setDatabaseInstance(db);

  databaseSetupProgressStore.update('Running database migrations...', 85);

  // Run migrations with per-migration progress updates
  await runMigrations(adapter, (index, total, version, description) => {
    const pct = Math.round(85 + (index / total) * 10);
    const vLabel = `v${String(version).padStart(3, '0')}`;
    databaseSetupProgressStore.update(
      `Running migration ${index + 1}/${total} (${vLabel}: ${description})...`,
      pct
    );
  });

  return db;
}

/**
 * Close the database connection while preserving adapter reuse for unlock.
 */
export async function closeDatabase(): Promise<void> {
  markDatabaseServicesUnavailable();
  await runWithDatabaseLifecycleLock(async () => {
    await closeDatabaseForInstance(currentInstanceId);
  });
}

/**
 * Change the database password.
 */
export async function changePassword(
  oldPassword: string,
  newPassword: string
): Promise<boolean> {
  const adapterInstance = _getAdapterInstance();
  const dbInstance = _getDatabaseInstance();
  if (!adapterInstance || !dbInstance || !currentInstanceId) {
    throw new Error('Database not initialized');
  }

  const startTime = performance.now();

  const keyManager = getKeyManagerForInstance(currentInstanceId);
  const keys = await keyManager.changePassword(oldPassword, newPassword);

  if (!keys) {
    return false; // Wrong old password
  }

  const shouldRekey =
    keys.oldKey.length !== keys.newKey.length ||
    keys.oldKey.some((value, index) => value !== keys.newKey[index]);

  if (shouldRekey) {
    // Pass oldKey for Capacitor which requires both keys for changeEncryptionSecret
    await adapterInstance.rekeyDatabase(keys.newKey, keys.oldKey);
  }

  // Log the password change event
  const durationMs = performance.now() - startTime;
  try {
    await logEvent(dbInstance, 'db_password_change', durationMs, true);
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
  await runWithDatabaseLifecycleLock(async () => {
    // Store adapter reference before closing
    const adapter = _getAdapterInstance();

    // Only close if this is the current instance
    if (currentInstanceId === instanceId) {
      await closeDatabaseForInstance(currentInstanceId);
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
    _setAdapterInstance(null);
    setAnalyticsAdapter(null);

    const keyManager = getKeyManagerForInstance(instanceId);
    // Clear any persisted session before full reset
    await keyManager.clearPersistedSession();
    await keyManager.reset();
  });
}

/**
 * Export the database to a byte array for backup.
 * The returned data is the raw encrypted database file.
 * @returns The encrypted database as a Uint8Array
 */
export async function exportDatabase(): Promise<Uint8Array> {
  const adapterInstance = _getAdapterInstance();
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
  await runWithDatabaseLifecycleLock(async () => {
    const adapterInstance = _getAdapterInstance();
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
    await runMigrations(adapterInstance);
  });
}

// Re-export schema and types
export * from './schema';
