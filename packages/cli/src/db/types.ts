/**
 * Database adapter interface and types for CLI.
 */

export interface DatabaseConfig {
  name: string;
  encryptionKey: Uint8Array;
}

export interface QueryResult {
  rows: Record<string, unknown>[];
  changes?: number;
  lastInsertRowId?: number;
}

export interface DatabaseAdapter {
  initialize(config: DatabaseConfig): Promise<void>;
  close(): Promise<void>;
  isOpen(): boolean;
  execute(sql: string, params?: unknown[]): Promise<QueryResult>;
  executeMany(statements: string[]): Promise<void>;
  rekeyDatabase(newKey: Uint8Array): Promise<void>;
  exportDatabaseAsJson(): Promise<string>;
  importDatabaseFromJson(
    jsonData: string,
    encryptionKey?: Uint8Array
  ): Promise<void>;
}

/**
 * JSON backup format for databases.
 */
export interface JsonBackupData {
  version: number;
  tables: { name: string; sql: string }[];
  indexes: { name: string; sql: string }[];
  data: Record<string, Record<string, unknown>[]>;
}
