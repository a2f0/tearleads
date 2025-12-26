/**
 * Type declarations for Electron preload APIs exposed on window.
 */

import type { QueryResult } from '@/db/adapters/types';

export interface ElectronSqliteApi {
  initialize: (config: {
    name: string;
    encryptionKey: number[];
  }) => Promise<void>;
  close: () => Promise<void>;
  execute: (sql: string, params?: unknown[]) => Promise<QueryResult>;
  executeMany: (statements: string[]) => Promise<void>;
  beginTransaction: () => Promise<void>;
  commit: () => Promise<void>;
  rollback: () => Promise<void>;
  rekey: (newKey: number[]) => Promise<void>;
  getSalt: () => Promise<number[] | null>;
  setSalt: (salt: number[]) => Promise<void>;
  getKeyCheckValue: () => Promise<string | null>;
  setKeyCheckValue: (kcv: string) => Promise<void>;
  clearKeyStorage: () => Promise<void>;
  deleteDatabase: (name: string) => Promise<void>;
  export: (name: string) => Promise<number[]>;
  import: (name: string, data: number[], key: number[]) => Promise<void>;
}

export interface ElectronApi {
  sqlite: ElectronSqliteApi;
}

export interface CapacitorGlobal {
  getPlatform: () => string;
  isNativePlatform: () => boolean;
}

declare global {
  interface Window {
    electron?: ElectronApi;
    Capacitor?: CapacitorGlobal;
  }
}
