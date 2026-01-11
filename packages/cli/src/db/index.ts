/**
 * Database operations for the CLI.
 */

import fs from 'node:fs/promises';
import { getConfigPaths } from '../config/index.js';
import {
  changePassword as changeKeyPassword,
  clearKey,
  getCurrentKey,
  hasExistingKey,
  hasPersistedSession,
  persistSession,
  restoreSession,
  setupNewKey,
  unlockWithPassword
} from '../crypto/key-manager.js';
import { NativeSqliteAdapter } from './adapter.js';

let adapter: NativeSqliteAdapter | null = null;

/**
 * Check if a database has been set up.
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
  const key = await setupNewKey(password);

  adapter = new NativeSqliteAdapter();
  await adapter.initialize(key);

  // Persist session for convenience
  await persistSession();
}

/**
 * Unlock an existing database with a password.
 */
export async function unlockDatabase(password: string): Promise<boolean> {
  const key = await unlockWithPassword(password);
  if (!key) {
    return false;
  }

  adapter = new NativeSqliteAdapter();
  await adapter.open(key);

  // Persist session for convenience
  await persistSession();

  return true;
}

/**
 * Restore a database session from persisted key.
 */
export async function restoreDatabaseSession(): Promise<boolean> {
  const key = await restoreSession();
  if (!key) {
    return false;
  }

  adapter = new NativeSqliteAdapter();
  await adapter.open(key);

  return true;
}

/**
 * Lock the database (close and clear key).
 */
export function lockDatabase(): void {
  if (adapter) {
    adapter.close();
    adapter = null;
  }
  clearKey();
}

/**
 * Export the database to JSON.
 */
export function exportDatabase(): Record<string, unknown[]> {
  if (!adapter || !adapter.isOpen()) {
    throw new Error('Database not open');
  }
  return adapter.exportToJson();
}

/**
 * Import data into the database from JSON.
 */
export function importDatabase(data: Record<string, unknown[]>): void {
  if (!adapter || !adapter.isOpen()) {
    throw new Error('Database not open');
  }
  adapter.importFromJson(data);
}

/**
 * Change the database password.
 */
export async function changePassword(
  oldPassword: string,
  newPassword: string
): Promise<boolean> {
  const result = await changeKeyPassword(oldPassword, newPassword);
  if (!result) {
    return false;
  }

  // Re-key the database if it's open
  if (adapter?.isOpen()) {
    await adapter.rekeyDatabase(result.newKey);
  } else {
    // Open with old key, re-key, close
    adapter = new NativeSqliteAdapter();
    await adapter.open(result.oldKey);
    await adapter.rekeyDatabase(result.newKey);
  }

  // Update persisted session
  await persistSession();

  return true;
}

/**
 * Get the current encryption key (for testing).
 */
export function getKey(): Uint8Array | null {
  return getCurrentKey();
}

/**
 * Reset the database (delete all data).
 */
export async function resetDatabase(): Promise<void> {
  lockDatabase();

  const paths = getConfigPaths();
  try {
    await fs.unlink(paths.database);
  } catch {
    // Ignore if file doesn't exist
  }
}

// Re-export for convenience
export { hasPersistedSession };
