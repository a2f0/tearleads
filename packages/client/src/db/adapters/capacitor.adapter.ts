/**
 * Capacitor adapter for SQLite using @capacitor-community/sqlite.
 * Uses SQLCipher for encryption on iOS and Android.
 */

import type {
  DatabaseAdapter,
  DatabaseConfig,
  QueryResult
} from './types';
import { convertRowsToArrays } from './utils';
import type {
  JsonSQLite,
  SQLiteConnection,
  SQLiteDBConnection
} from '@capacitor-community/sqlite';

/**
 * Error messages that can be safely ignored when deleting a database.
 * These occur when the database doesn't exist (fresh install, already deleted, etc.)
 * or when there's no active connection to it.
 */
const IGNORABLE_DELETE_DB_ERRORS = [
  'not found',
  'does not exist',
  'no available connection'
];

/**
 * Check if a database deletion error should be ignored.
 * Returns true if the error indicates the database simply doesn't exist.
 */
function isIgnorableDeleteDbError(error: unknown): boolean {
  const message = error instanceof Error ? error.message.toLowerCase() : '';
  return IGNORABLE_DELETE_DB_ERRORS.some((msg) => message.includes(msg));
}

let sqliteConnection: SQLiteConnection | null = null;

async function getSQLiteConnection(): Promise<SQLiteConnection> {
  if (sqliteConnection) return sqliteConnection;

  const { CapacitorSQLite, SQLiteConnection } = await import(
    '@capacitor-community/sqlite'
  );

  // Test that the plugin is properly initialized by calling echo
  // This catches the "CapacitorSQLitePlugin: null" error early with a better message
  try {
    await CapacitorSQLite.echo({ value: 'test' });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes('CapacitorSQLitePlugin') && message.includes('null')) {
      throw new Error(
        'SQLite plugin failed to initialize. Try clearing app data in Settings > Apps > Tearleads > Clear Storage, then reopen the app.'
      );
    }
    throw err;
  }

  const connection = new SQLiteConnection(CapacitorSQLite);
  sqliteConnection = connection;
  return sqliteConnection;
}

export class CapacitorAdapter implements DatabaseAdapter {
  private dbName: string | null = null;
  private db: SQLiteDBConnection | null = null;
  private isInitialized = false;

  async initialize(config: DatabaseConfig): Promise<void> {
    this.dbName = config.name;

    const sqlite = await getSQLiteConnection();

    // Check if a connection already exists and close it first
    const { result: hasConnection } = await sqlite.isConnection(
      config.name,
      false
    );
    if (hasConnection) {
      try {
        await sqlite.closeConnection(config.name, false);
      } catch {
        // Ignore errors closing stale connection
      }
    }

    const keyHex = Array.from(config.encryptionKey)
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');

    // Always clear and set the encryption secret to ensure we use the correct key.
    // This handles the case where reset was called but clearEncryptionSecret failed
    // silently, or where the stored secret doesn't match the current key.
    const { result: isStored } = await sqlite.isSecretStored();
    if (isStored) {
      await sqlite.clearEncryptionSecret();
    }

    try {
      await sqlite.setEncryptionSecret(keyHex);
    } catch (err) {
      // Handle recoverable errors during setEncryptionSecret:
      // 1. "State for" errors: stale database file from previous session with different encryption
      // 2. "passphrase has already been set": Android-specific issue where clearEncryptionSecret
      //    didn't fully clear the SharedPreferences (race condition or caching)
      const errorMessage = err instanceof Error ? err.message : '';
      const isStateError = errorMessage.toLowerCase().includes('state for');
      const isPassphraseAlreadySetError = errorMessage
        .toLowerCase()
        .includes('passphrase has already been set');

      if (isStateError || isPassphraseAlreadySetError) {
        console.warn(
          `Recovering from database secret error by clearing and retrying: ${errorMessage}`
        );
        const { CapacitorSQLite } = await import('@capacitor-community/sqlite');

        // For "State for" errors, also delete the database file
        if (isStateError) {
          try {
            await CapacitorSQLite.deleteDatabase({ database: config.name });
          } catch (deleteErr: unknown) {
            if (!isIgnorableDeleteDbError(deleteErr)) {
              throw deleteErr;
            }
          }
        }

        // Force clear the encryption secret again before retrying
        // This handles Android's SharedPreferences not being fully cleared
        try {
          await CapacitorSQLite.clearEncryptionSecret();
        } catch (clearErr: unknown) {
          // Only ignore errors indicating the secret doesn't exist
          const message =
            clearErr instanceof Error ? clearErr.message.toLowerCase() : '';
          if (
            !message.includes('no secret') &&
            !message.includes('not stored')
          ) {
            throw clearErr;
          }
        }

        await sqlite.setEncryptionSecret(keyHex);
      } else {
        throw err;
      }
    }

    // Create connection with encryption enabled
    // Mode 'secret' uses the passphrase stored via setEncryptionSecret
    this.db = await sqlite.createConnection(
      config.name,
      true, // encrypted
      'secret',
      1, // version
      false // readonly
    );

    await this.db.open();

    // Note: PRAGMA statements are not supported via the plugin's query/execute methods
    // on Android. WAL mode and foreign keys are typically enabled by default or
    // configured at the native level.

    this.isInitialized = true;
  }

  async close(): Promise<void> {
    if (this.db && this.isInitialized && this.dbName) {
      await this.db.close();

      const sqlite = await getSQLiteConnection();
      await sqlite.closeConnection(this.dbName, false);

      this.isInitialized = false;
    }
    this.db = null;
    this.dbName = null;
  }

  isOpen(): boolean {
    return this.isInitialized;
  }

  async execute(sql: string, params?: unknown[]): Promise<QueryResult> {
    if (!this.db || !this.isInitialized) {
      throw new Error('Database not initialized');
    }

    // Determine if this is a SELECT query
    const isSelect =
      sql.trim().toUpperCase().startsWith('SELECT') ||
      sql.trim().toUpperCase().startsWith('PRAGMA');

    if (isSelect) {
      const result = await this.db.query(sql, params);
      return {
        rows: result.values ?? []
      };
    }

    const result = await this.db.run(sql, params, false);

    const queryResult: QueryResult = {
      rows: []
    };
    if (result.changes?.changes !== undefined) {
      queryResult.changes = result.changes.changes;
    }
    if (result.changes?.lastId !== undefined) {
      queryResult.lastInsertRowId = result.changes.lastId;
    }
    return queryResult;
  }

  async executeMany(statements: string[]): Promise<void> {
    if (!this.db || !this.isInitialized) {
      throw new Error('Database not initialized');
    }

    // Plugin requires 'values' array even if empty
    await this.db.executeSet(
      statements.map((statement) => ({ statement, values: [] })),
      true
    );
  }

  async beginTransaction(): Promise<void> {
    await this.execute('BEGIN TRANSACTION');
  }

  async commitTransaction(): Promise<void> {
    await this.execute('COMMIT');
  }

  async rollbackTransaction(): Promise<void> {
    await this.execute('ROLLBACK');
  }

  async rekeyDatabase(newKey: Uint8Array, oldKey?: Uint8Array): Promise<void> {
    if (!this.db || !this.isInitialized || !this.dbName) {
      throw new Error('Database not initialized');
    }
    if (!oldKey) {
      throw new Error('Capacitor adapter requires the old key for rekeying');
    }

    const sqlite = await getSQLiteConnection();

    const newKeyHex = Array.from(newKey)
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');

    const oldKeyHex = Array.from(oldKey)
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');

    // Close current connection before changing the secret
    await this.db.close();
    await sqlite.closeConnection(this.dbName, false);

    // Use changeEncryptionSecret which handles both rekeying the database
    // and updating the stored secret in secure storage (Keychain/EncryptedSharedPreferences)
    await sqlite.changeEncryptionSecret(newKeyHex, oldKeyHex);

    // Reopen the connection with the new key
    this.db = await sqlite.createConnection(
      this.dbName,
      true, // encrypted
      'secret',
      1, // version
      false // readonly
    );

    await this.db.open();
  }

  getConnection(): unknown {
    // For Drizzle sqlite-proxy, return a function that always returns { rows: any[] }
    // IMPORTANT: Drizzle sqlite-proxy expects rows as ARRAYS of values, not objects.
    // The values must be in the same order as columns in the SELECT clause.
    return async (
      sql: string,
      params: unknown[],
      _method: 'all' | 'get' | 'run' | 'values'
    ): Promise<{ rows: unknown[] }> => {
      const result = await this.execute(sql, params);

      // Drizzle sqlite-proxy expects { rows: any[] } for ALL methods
      // The rows must be ARRAYS of values in SELECT column order, not objects.
      // convertRowsToArrays handles both explicit SELECT and SELECT * queries.
      const arrayRows = convertRowsToArrays(sql, result.rows);
      return { rows: arrayRows };
    };
  }

  async deleteDatabase(name: string): Promise<void> {
    const sqlite = await getSQLiteConnection();
    const { CapacitorSQLite } = await import('@capacitor-community/sqlite');

    // Close any existing connection first
    const { result: hasConnection } = await sqlite.isConnection(name, false);
    if (hasConnection) {
      try {
        await sqlite.closeConnection(name, false);
      } catch {
        // Ignore errors
      }
    }

    // Note: deleteDatabase is on CapacitorSQLite, not SQLiteConnection
    try {
      await CapacitorSQLite.deleteDatabase({ database: name });
    } catch (error: unknown) {
      if (!isIgnorableDeleteDbError(error)) {
        throw error;
      }
    }

    try {
      await CapacitorSQLite.clearEncryptionSecret();
    } catch (error: unknown) {
      // Only ignore "no secret stored" errors
      const message = error instanceof Error ? error.message.toLowerCase() : '';
      if (!message.includes('no secret') && !message.includes('not stored')) {
        throw error;
      }
    }

    sqliteConnection = null;

    this.db = null;
    this.dbName = null;
    this.isInitialized = false;
  }

  async exportDatabase(): Promise<Uint8Array> {
    if (!this.db || !this.isInitialized || !this.dbName) {
      throw new Error('Database not initialized');
    }

    const sqlite = await getSQLiteConnection();
    const { Filesystem, Directory } = await import('@capacitor/filesystem');
    const { Capacitor } = await import('@capacitor/core');

    // Close connection to ensure all data is flushed
    await this.db.close();
    await sqlite.closeConnection(this.dbName, false);

    try {
      // Get the database file path based on platform
      // iOS: Library/CapacitorDatabase/{name}SQLite.db
      // Android: databases/{name}SQLite.db
      const platform = Capacitor.getPlatform();
      const dbFileName = `${this.dbName}SQLite.db`;
      let filePath: string;
      let directory: typeof Directory.Library | typeof Directory.Data;

      if (platform === 'ios') {
        filePath = `CapacitorDatabase/${dbFileName}`;
        directory = Directory.Library;
      } else {
        // Android - need to use a relative path from Data directory
        filePath = `../databases/${dbFileName}`;
        directory = Directory.Data;
      }

      const result = await Filesystem.readFile({
        path: filePath,
        directory
      });

      // Convert base64 to Uint8Array
      if (typeof result.data !== 'string') {
        throw new Error('Unexpected database export data');
      }
      const base64Data = result.data;
      const binaryString = atob(base64Data);
      return Uint8Array.from(binaryString, (c) => c.charCodeAt(0));
    } finally {
      // Re-open the connection
      this.db = await sqlite.createConnection(
        this.dbName,
        true,
        'secret',
        1,
        false
      );
      await this.db.open();
    }
  }

  async importDatabase(data: Uint8Array): Promise<void> {
    if (!this.dbName) {
      throw new Error('Database name not set');
    }

    const sqlite = await getSQLiteConnection();
    const { Filesystem, Directory } = await import('@capacitor/filesystem');
    const { Capacitor } = await import('@capacitor/core');

    // Get the database file path based on platform
    const platform = Capacitor.getPlatform();
    const dbFileName = `${this.dbName}SQLite.db`;
    const backupFileName = `${this.dbName}SQLite.db.backup`;
    let filePath: string;
    let backupPath: string;
    let directory: typeof Directory.Library | typeof Directory.Data;

    if (platform === 'ios') {
      filePath = `CapacitorDatabase/${dbFileName}`;
      backupPath = `CapacitorDatabase/${backupFileName}`;
      directory = Directory.Library;
    } else {
      filePath = `../databases/${dbFileName}`;
      backupPath = `../databases/${backupFileName}`;
      directory = Directory.Data;
    }

    // Backup current database before import
    try {
      const currentDb = await Filesystem.readFile({
        path: filePath,
        directory
      });
      await Filesystem.writeFile({
        path: backupPath,
        data: currentDb.data,
        directory
      });
    } catch {
      // Ignore if file doesn't exist (first time setup)
    }

    // Close current connection
    if (this.db && this.isInitialized) {
      await this.db.close();
      await sqlite.closeConnection(this.dbName, false);
    }

    // Convert Uint8Array to base64 in chunks to avoid stack overflow
    const CHUNK_SIZE = 0x8000; // 32k characters
    let binary = '';
    for (let i = 0; i < data.length; i += CHUNK_SIZE) {
      binary += String.fromCharCode.apply(
        null,
        Array.from(data.subarray(i, i + CHUNK_SIZE))
      );
    }
    const base64Data = btoa(binary);

    try {
      // Write the database file
      await Filesystem.writeFile({
        path: filePath,
        data: base64Data,
        directory
      });

      // Remove backup on success
      try {
        await Filesystem.deleteFile({
          path: backupPath,
          directory
        });
      } catch {
        // Ignore cleanup errors
      }
    } catch (error) {
      // Restore from backup on failure
      try {
        const backup = await Filesystem.readFile({
          path: backupPath,
          directory
        });
        await Filesystem.writeFile({
          path: filePath,
          data: backup.data,
          directory
        });
      } catch {
        // Best effort restore
      }
      throw error;
    }

    // Database will be reopened on next initialize() call
    this.db = null;
    this.isInitialized = false;
  }
}
