/**
 * Shared database state module.
 * Extracted to break circular dependency between index.ts and analytics.ts.
 */

import type { Database } from '@tearleads/db/sqlite';
import type { DatabaseAdapter } from './adapters';

let databaseInstance: Database | null = null;
let adapterInstance: DatabaseAdapter | null = null;

/**
 * Get the database instance (internal use only).
 */
export function _getDatabaseInstance(): Database | null {
  return databaseInstance;
}

/**
 * Set the database instance (internal use only).
 */
export function _setDatabaseInstance(db: Database | null): void {
  databaseInstance = db;
}

/**
 * Get the adapter instance (internal use only).
 */
export function _getAdapterInstance(): DatabaseAdapter | null {
  return adapterInstance;
}

/**
 * Set the adapter instance (internal use only).
 */
export function _setAdapterInstance(adapter: DatabaseAdapter | null): void {
  adapterInstance = adapter;
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
 * Check if the database is initialized and ready for use.
 * This is true after setup/unlock and false after close/reset.
 */
export function isDatabaseInitialized(): boolean {
  return databaseInstance !== null;
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
