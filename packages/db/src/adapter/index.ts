/**
 * Database adapter interface and types.
 * All platform-specific adapters must implement this interface.
 */

export interface DatabaseConfig {
  /** Database file name */
  name: string;
  /** Encryption key bytes */
  encryptionKey: Uint8Array;
  /** Storage location (for Capacitor) */
  location?: 'default' | 'documents' | 'library';
}

export interface QueryResult {
  /** Rows returned by the query */
  rows: Record<string, unknown>[];
  /** Number of rows affected (for INSERT/UPDATE/DELETE) */
  changes?: number;
  /** Last inserted row ID */
  lastInsertRowId?: number;
}

export type DrizzleConnectionMethod = 'all' | 'get' | 'run' | 'values';

export type DrizzleConnection = (
  sql: string,
  params: unknown[],
  method: DrizzleConnectionMethod
) => Promise<{ rows: unknown[] }>;

export interface DatabaseAdapter {
  /**
   * Initialize the database connection with encryption.
   */
  initialize(config: DatabaseConfig): Promise<void>;

  /**
   * Close the database connection.
   */
  close(): Promise<void>;

  /**
   * Check if the database is open.
   */
  isOpen(): boolean;

  /**
   * Execute a single SQL statement.
   */
  execute(sql: string, params?: unknown[]): Promise<QueryResult>;

  /**
   * Execute multiple SQL statements in sequence.
   */
  executeMany(statements: string[]): Promise<void>;

  /**
   * Begin a transaction.
   */
  beginTransaction(): Promise<void>;

  /**
   * Commit the current transaction.
   */
  commitTransaction(): Promise<void>;

  /**
   * Rollback the current transaction.
   */
  rollbackTransaction(): Promise<void>;

  /**
   * Re-key the database with a new encryption key.
   * Used for password changes.
   * @param newKey - The new encryption key
   * @param oldKey - The old encryption key (required for Capacitor)
   */
  rekeyDatabase(newKey: Uint8Array, oldKey?: Uint8Array): Promise<void>;

  /**
   * Get the raw database connection for Drizzle.
   */
  getConnection(): DrizzleConnection;

  /**
   * Delete the database file.
   * Used during reset to ensure a clean slate.
   */
  deleteDatabase?(name: string): Promise<void>;

  /**
   * Export the database to a byte array.
   * Returns the encrypted database file content.
   */
  exportDatabase(): Promise<Uint8Array>;

  /**
   * Import a database from a byte array.
   * Replaces the current database with the imported data.
   * @param data - The encrypted database file bytes
   * @param encryptionKey - The encryption key to use when reopening (required for Electron)
   */
  importDatabase(data: Uint8Array, encryptionKey?: Uint8Array): Promise<void>;
}

/**
 * Platform information for adapter selection.
 */
export type Platform = 'web' | 'electron' | 'ios' | 'android' | 'node';

export interface PlatformInfo {
  platform: Platform;
  supportsNativeEncryption: boolean;
  requiresWebWorker: boolean;
}

/**
 * Get platform info for adapter selection.
 * Uses Record<string, unknown> access for window properties to avoid
 * requiring client-specific Window type augmentations.
 */
export function getPlatformInfo(): PlatformInfo {
  if (typeof window === 'undefined') {
    return {
      platform: 'web',
      supportsNativeEncryption: false,
      requiresWebWorker: true
    };
  }

  const win = window as unknown as Record<string, unknown>;

  // Check for Electron first
  if (win['electron']) {
    return {
      platform: 'electron',
      supportsNativeEncryption: true,
      requiresWebWorker: false
    };
  }

  // Check for Capacitor native
  try {
    const capacitor = win['Capacitor'] as
      | {
          isNativePlatform(): boolean;
          getPlatform(): string;
        }
      | undefined;

    if (capacitor?.isNativePlatform()) {
      const platform = capacitor.getPlatform();
      if (platform === 'ios') {
        return {
          platform: 'ios',
          supportsNativeEncryption: true,
          requiresWebWorker: false
        };
      }
      if (platform === 'android') {
        return {
          platform: 'android',
          supportsNativeEncryption: true,
          requiresWebWorker: false
        };
      }
    }
  } catch {
    // Capacitor not available
  }

  // Default to web
  return {
    platform: 'web',
    supportsNativeEncryption: false,
    requiresWebWorker: true
  };
}

export {
  convertRowsToArrays,
  extractSelectColumns,
  rowToArray
} from './utils.js';
