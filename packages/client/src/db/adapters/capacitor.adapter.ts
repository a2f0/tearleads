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
  clearEncryptionSecret(): Promise<void>;
  importFromJson(jsonstring: string): Promise<{ changes: { changes: number } }>;
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
  exportToJson(mode: string): Promise<{ export: JsonSQLite }>;
}

interface JsonSQLite {
  database: string;
  version: number;
  encrypted: boolean;
  mode: string;
  tables: JsonTable[];
}

interface JsonTable {
  name: string;
  schema?: JsonColumn[];
  indexes?: JsonIndex[];
  triggers?: JsonTrigger[];
  values?: unknown[][];
}

interface JsonColumn {
  column: string;
  value: string;
  foreignkey?: string;
  constraint?: string;
}

interface JsonIndex {
  name: string;
  value: string;
  mode?: string;
}

interface JsonTrigger {
  name: string;
  timeevent: string;
  condition?: string;
  logic: string;
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

    try {
      await sqlite.setEncryptionSecret(keyHex);
    } catch (err) {
      // If setEncryptionSecret fails due to incorrect state (stale database file
      // from a previous session with different encryption), delete the database
      // file and retry. This commonly happens during repeated reset/setup cycles.
      if (err instanceof Error && err.message.includes('State for')) {
        console.warn(
          `Recovering from database state error by deleting and retrying: ${err.message}`
        );
        const { CapacitorSQLite } = await import('@capacitor-community/sqlite');
        await CapacitorSQLite.deleteDatabase({ database: config.name });
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

    // Delete the database file
    // Note: deleteDatabase is on CapacitorSQLite, not SQLiteConnection
    try {
      await CapacitorSQLite.deleteDatabase({ database: name });
    } catch (error: unknown) {
      // Only ignore "database not found" errors
      const message = error instanceof Error ? error.message.toLowerCase() : '';
      if (
        !message.includes('not found') &&
        !message.includes('does not exist')
      ) {
        throw error;
      }
    }

    // Clear the stored encryption secret so a new one can be set
    try {
      await CapacitorSQLite.clearEncryptionSecret();
    } catch (error: unknown) {
      // Only ignore "no secret stored" errors
      const message = error instanceof Error ? error.message.toLowerCase() : '';
      if (!message.includes('no secret') && !message.includes('not stored')) {
        throw error;
      }
    }

    // Reset the module-level connection to force fresh state
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
      const base64Data = result.data as string;
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
