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
   * The type varies by platform.
   */
  getConnection(): unknown;

  /**
   * Delete the database file.
   * Used during reset to ensure a clean slate.
   */
  deleteDatabase?(name: string): Promise<void>;
}

/**
 * Platform information for adapter selection.
 */
export type Platform = 'web' | 'electron' | 'ios' | 'android';

export interface PlatformInfo {
  platform: Platform;
  supportsNativeEncryption: boolean;
  requiresWebWorker: boolean;
}

/**
 * Get platform info for adapter selection.
 */
export function getPlatformInfo(): PlatformInfo {
  // Check for Electron first
  if (
    typeof window !== 'undefined' &&
    (window as unknown as { electron?: unknown }).electron
  ) {
    return {
      platform: 'electron',
      supportsNativeEncryption: true,
      requiresWebWorker: false
    };
  }

  // Check for Capacitor native
  try {
    // Dynamic check to avoid import errors
    const Capacitor = (
      window as unknown as {
        Capacitor?: {
          getPlatform: () => string;
          isNativePlatform: () => boolean;
        };
      }
    ).Capacitor;

    if (Capacitor?.isNativePlatform()) {
      const platform = Capacitor.getPlatform();
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
