/**
 * Capacitor adapter for SQLite using @capacitor-community/sqlite.
 * Uses SQLCipher for encryption on iOS and Android.
 */

import type { DatabaseAdapter, DatabaseConfig, QueryResult } from './types';

// Types for SQLiteConnection wrapper
interface SQLiteConnectionWrapper {
  createConnection(
    database: string,
    encrypted: boolean,
    mode: string,
    version: number,
    readonly: boolean
  ): Promise<SQLiteDBConnection>;
  closeConnection(database: string, readonly: boolean): Promise<void>;
  isConnection(
    database: string,
    readonly: boolean
  ): Promise<{ result: boolean }>;
  isSecretStored(): Promise<{ result: boolean }>;
  setEncryptionSecret(passphrase: string): Promise<void>;
  changeEncryptionSecret(
    passphrase: string,
    oldpassphrase: string
  ): Promise<void>;
  deleteDatabase(database: string): Promise<void>;
  clearEncryptionSecret(): Promise<void>;
}

interface SQLiteDBConnection {
  open(): Promise<void>;
  close(): Promise<void>;
  execute(
    statements: string,
    transaction?: boolean
  ): Promise<{ changes?: { changes: number; lastId: number } }>;
  query(
    statement: string,
    values?: unknown[]
  ): Promise<{ values?: Record<string, unknown>[] }>;
  run(
    statement: string,
    values?: unknown[],
    transaction?: boolean
  ): Promise<{ changes?: { changes: number; lastId: number } }>;
  executeSet(
    set: Array<{ statement: string; values?: unknown[] }>,
    transaction?: boolean
  ): Promise<{ changes?: { changes: number; lastId: number } }>;
  isDBOpen(): Promise<boolean>;
}

let sqliteConnection: SQLiteConnectionWrapper | null = null;

async function getSQLiteConnection(): Promise<SQLiteConnectionWrapper> {
  if (sqliteConnection) return sqliteConnection;

  const { CapacitorSQLite, SQLiteConnection } = await import(
    '@capacitor-community/sqlite'
  );
  sqliteConnection = new SQLiteConnection(
    CapacitorSQLite
  ) as unknown as SQLiteConnectionWrapper;
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

    // Set the encryption key as hex string for SQLCipher
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
    await sqlite.setEncryptionSecret(keyHex);

    // Create connection with encryption enabled
    // Mode 'secret' uses the passphrase stored via setEncryptionSecret
    this.db = await sqlite.createConnection(
      config.name,
      true, // encrypted
      'secret',
      1, // version
      false // readonly
    );

    // Open the database
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
    return async (
      sql: string,
      params: unknown[],
      _method: 'all' | 'get' | 'run' | 'values'
    ): Promise<{ rows: unknown[] }> => {
      const result = await this.execute(sql, params);

      // Drizzle sqlite-proxy expects { rows: any[] } for ALL methods
      // The method parameter tells Drizzle how to interpret the rows
      return { rows: result.rows };
    };
  }

  async deleteDatabase(name: string): Promise<void> {
    const sqlite = await getSQLiteConnection();

    // Close any existing connection first
    const { result: hasConnection } = await sqlite.isConnection(name, false);
    if (hasConnection) {
      try {
        await sqlite.closeConnection(name, false);
      } catch {
        // Ignore errors
      }
    }

    // Delete the database file
    try {
      await sqlite.deleteDatabase(name);
    } catch {
      // Ignore errors if database doesn't exist
    }

    // Clear the stored encryption secret so a new one can be set
    // This is on CapacitorSQLite directly, not the SQLiteConnection wrapper
    try {
      const { CapacitorSQLite } = await import('@capacitor-community/sqlite');
      await CapacitorSQLite.clearEncryptionSecret();
    } catch {
      // Ignore errors if not supported or no secret stored
    }

    // Reset the module-level connection to force fresh state
    sqliteConnection = null;

    this.db = null;
    this.dbName = null;
    this.isInitialized = false;
  }
}
