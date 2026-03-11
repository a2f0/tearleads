import type { SQLiteDBConnection } from '@capacitor-community/sqlite';
import { normalizeSqlStatements } from '@/db/sql/sqlBatch';
import {
  deleteCapacitorDatabaseFile,
  getSQLiteConnection,
  isIgnorableDeleteDbError,
  resetSQLiteConnectionCache
} from './capacitorAdapterHelpers';
import { SavepointTransactionManager } from './savepointTransactionManager';
import type {
  DatabaseAdapter,
  DatabaseConfig,
  DrizzleConnection,
  QueryResult
} from './types';
import { convertRowsToArrays } from './utils';

export class CapacitorAdapter implements DatabaseAdapter {
  private dbName: string | null = null;
  private db: SQLiteDBConnection | null = null;
  private isInitialized = false;
  private readonly transactionManager = new SavepointTransactionManager(
    {
      beginRoot: async () => {
        await this.requireOpenDb().beginTransaction();
      },
      commitRoot: async () => {
        await this.requireOpenDb().commitTransaction();
      },
      rollbackRoot: async () => {
        await this.requireOpenDb().rollbackTransaction();
      },
      executeSql: async (sql: string) => {
        await this.execute(sql);
      },
      isRootTransactionActive: async () => {
        const { result } = await this.requireOpenDb().isTransactionActive();
        return result === true;
      }
    },
    'sp_cap_tx'
  );

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

    // Always clear and re-set the encryption secret to ensure correct key
    const { result: isStored } = await sqlite.isSecretStored();
    if (isStored) {
      await sqlite.clearEncryptionSecret();
    }

    try {
      await sqlite.setEncryptionSecret(keyHex);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : '';
      const isStateError = errorMessage.toLowerCase().includes('state for');
      const isPassphraseAlreadySetError = errorMessage
        .toLowerCase()
        .includes('passphrase has already been set');

      if (isStateError || isPassphraseAlreadySetError) {
        console.warn(`Recovering from secret error: ${errorMessage}`);
        const { CapacitorSQLite } = await import('@capacitor-community/sqlite');

        if (isStateError) {
          try {
            await CapacitorSQLite.deleteDatabase({ database: config.name });
          } catch (deleteErr: unknown) {
            if (!isIgnorableDeleteDbError(deleteErr)) {
              throw deleteErr;
            }
            await deleteCapacitorDatabaseFile(config.name);
          }
        }

        try {
          await CapacitorSQLite.clearEncryptionSecret();
        } catch (clearErr: unknown) {
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

    try {
      await this.db.open();
    } catch (openErr) {
      // "Cannot open the DB" happens when a stale database file exists encrypted
      // with a different key (e.g., after app reinstall where Keychain was lost
      // but the DB file persisted). Delete the stale file and retry.
      const msg = openErr instanceof Error ? openErr.message : '';
      if (msg.toLowerCase().includes('cannot open')) {
        console.warn(`Recovering from stale DB file: ${msg}`);
        const { CapacitorSQLite } = await import('@capacitor-community/sqlite');

        // Close the failed connection
        try {
          await sqlite.closeConnection(config.name, false);
        } catch {
          // Ignore
        }

        // Delete the stale database file
        try {
          await CapacitorSQLite.deleteDatabase({ database: config.name });
        } catch (deleteErr: unknown) {
          if (!isIgnorableDeleteDbError(deleteErr)) {
            throw deleteErr;
          }
          await deleteCapacitorDatabaseFile(config.name);
        }

        // Recreate connection and open (creates a fresh empty database)
        this.db = await sqlite.createConnection(
          config.name,
          true,
          'secret',
          1,
          false
        );
        await this.db.open();
      } else {
        throw openErr;
      }
    }

    this.isInitialized = true;
    this.transactionManager.reset();
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
    this.transactionManager.reset();
  }

  isOpen(): boolean {
    return this.isInitialized;
  }

  private requireOpenDb(): SQLiteDBConnection {
    if (!this.db || !this.isInitialized) {
      throw new Error('Database not initialized');
    }
    return this.db;
  }

  async execute(sql: string, params?: unknown[]): Promise<QueryResult> {
    const db = this.requireOpenDb();

    // Determine if this is a SELECT query
    const isSelect =
      sql.trim().toUpperCase().startsWith('SELECT') ||
      sql.trim().toUpperCase().startsWith('PRAGMA');

    if (isSelect) {
      const result = await db.query(sql, params);
      return {
        rows: result.values ?? []
      };
    }

    const result = await db.run(sql, params, false);

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
    const db = this.requireOpenDb();
    const normalizedStatements = normalizeSqlStatements(statements);
    if (normalizedStatements.length === 0) {
      return;
    }

    const { result: isTransactionActive } = await db.isTransactionActive();

    // Plugin requires 'values' array even if empty
    await db.executeSet(
      normalizedStatements.map((statement) => ({ statement, values: [] })),
      !isTransactionActive
    );
  }

  async beginTransaction(): Promise<void> {
    await this.transactionManager.begin();
  }

  async commitTransaction(): Promise<void> {
    await this.transactionManager.commit();
  }

  async rollbackTransaction(): Promise<void> {
    await this.transactionManager.rollback();
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

    await sqlite.changeEncryptionSecret(newKeyHex, oldKeyHex);

    this.db = await sqlite.createConnection(
      this.dbName,
      true, // encrypted
      'secret',
      1, // version
      false // readonly
    );

    await this.db.open();
    this.transactionManager.reset();
  }

  getConnection(): DrizzleConnection {
    return async (
      sql: string,
      params: unknown[],
      _method: 'all' | 'get' | 'run' | 'values'
    ): Promise<{ rows: unknown[] }> => {
      const result = await this.execute(sql, params);
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

    resetSQLiteConnectionCache();

    this.db = null;
    this.dbName = null;
    this.isInitialized = false;
    this.transactionManager.reset();
  }

  async exportDatabase(): Promise<Uint8Array> {
    if (!this.db || !this.isInitialized || !this.dbName) {
      throw new Error('Database not initialized');
    }

    const sqlite = await getSQLiteConnection();
    const { Filesystem, Directory } = await import('@capacitor/filesystem');
    const { Capacitor } = await import('@capacitor/core');

    await this.db.close();
    await sqlite.closeConnection(this.dbName, false);

    try {
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

    if (this.db && this.isInitialized) {
      await this.db.close();
      await sqlite.closeConnection(this.dbName, false);
    }

    const CHUNK_SIZE = 0x8000;
    let binary = '';
    for (let i = 0; i < data.length; i += CHUNK_SIZE) {
      binary += String.fromCharCode.apply(
        null,
        Array.from(data.subarray(i, i + CHUNK_SIZE))
      );
    }
    const base64Data = btoa(binary);

    try {
      await Filesystem.writeFile({
        path: filePath,
        data: base64Data,
        directory
      });

      try {
        await Filesystem.deleteFile({
          path: backupPath,
          directory
        });
      } catch {
        // Ignore cleanup errors
      }
    } catch (error) {
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
        // Best effort
      }
      throw error;
    }

    this.db = null;
    this.isInitialized = false;
  }
}
