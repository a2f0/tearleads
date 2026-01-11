/**
 * Database factory for CLI.
 * Manages database lifecycle including setup, unlock, and operations.
 */

import {
  clearKey,
  clearPersistedSession,
  getCurrentKey,
  hasExistingKey,
  hasPersistedSession,
  changePassword as keyManagerChangePassword,
  persistSession,
  restoreSession,
  setupNewKey,
  unlockWithPassword
} from '../crypto/key-manager.js';
import { WasmNodeAdapter } from './adapter.js';
import type { DatabaseAdapter } from './types.js';

const DATABASE_NAME = 'tearleads';

let adapter: DatabaseAdapter | null = null;

/**
 * Get the current adapter (for testing).
 */
export function getAdapter(): DatabaseAdapter | null {
  return adapter;
}

/**
 * Check if the database has been set up.
 */
export async function isDatabaseSetUp(): Promise<boolean> {
  return hasExistingKey();
}

/**
 * Check if the database is currently unlocked.
 */
export function isDatabaseUnlocked(): boolean {
  return adapter?.isOpen() ?? false;
}

/**
 * Set up a new database with a password.
 */
export async function setupDatabase(password: string): Promise<void> {
  if (await isDatabaseSetUp()) {
    throw new Error('Database already set up. Use changePassword to change.');
  }

  const key = await setupNewKey(password);
  adapter = new WasmNodeAdapter();
  await adapter.initialize({
    name: DATABASE_NAME,
    encryptionKey: key
  });

  await persistSession();
}

/**
 * Unlock the database with a password.
 */
export async function unlockDatabase(password: string): Promise<boolean> {
  if (!(await isDatabaseSetUp())) {
    throw new Error('Database not set up. Use setupDatabase first.');
  }

  const key = await unlockWithPassword(password);
  if (!key) {
    return false;
  }

  adapter = new WasmNodeAdapter();
  await adapter.initialize({
    name: DATABASE_NAME,
    encryptionKey: key
  });

  await persistSession();
  return true;
}

/**
 * Try to restore a database session without a password.
 */
export async function restoreDatabaseSession(): Promise<boolean> {
  if (!(await hasPersistedSession())) {
    return false;
  }

  const key = await restoreSession();
  if (!key) {
    return false;
  }

  adapter = new WasmNodeAdapter();
  await adapter.initialize({
    name: DATABASE_NAME,
    encryptionKey: key
  });

  return true;
}

/**
 * Lock the database (close and clear session).
 */
export async function lockDatabase(): Promise<void> {
  if (adapter) {
    await adapter.close();
    adapter = null;
  }
  clearKey();
  await clearPersistedSession();
}

/**
 * Close the database without clearing session.
 */
export async function closeDatabase(): Promise<void> {
  if (adapter) {
    await adapter.close();
    adapter = null;
  }
}

/**
 * Change the database password.
 */
export async function changePassword(
  oldPassword: string,
  newPassword: string
): Promise<boolean> {
  const result = await keyManagerChangePassword(oldPassword, newPassword);
  if (!result) {
    return false;
  }

  if (adapter?.isOpen()) {
    await adapter.rekeyDatabase(result.newKey);
  }

  await persistSession();
  return true;
}

/**
 * Export the database as JSON.
 */
export async function exportDatabase(): Promise<string> {
  if (!adapter || !adapter.isOpen()) {
    throw new Error('Database not unlocked');
  }

  return adapter.exportDatabaseAsJson();
}

/**
 * Import the database from JSON.
 */
export async function importDatabase(jsonData: string): Promise<void> {
  const key = getCurrentKey();
  if (!key) {
    throw new Error('Database not unlocked');
  }

  if (!adapter) {
    adapter = new WasmNodeAdapter();
  }

  await adapter.importDatabaseFromJson(jsonData, key);
}

/**
 * Execute a SQL query.
 */
export async function execute(
  sql: string,
  params?: unknown[]
): Promise<{ rows: Record<string, unknown>[] }> {
  if (!adapter || !adapter.isOpen()) {
    throw new Error('Database not unlocked');
  }

  return adapter.execute(sql, params);
}
