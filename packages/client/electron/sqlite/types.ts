/**
 * Types for Electron SQLite handler.
 */

export interface QueryResult {
  rows: Record<string, unknown>[];
  changes?: number;
  lastInsertRowId?: number;
}

export interface InitializeConfig {
  name: string;
  encryptionKey: number[];
}
