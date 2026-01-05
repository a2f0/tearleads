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
  getSalt: (instanceId: string) => Promise<number[] | null>;
  setSalt: (salt: number[], instanceId: string) => Promise<void>;
  getKeyCheckValue: (instanceId: string) => Promise<string | null>;
  setKeyCheckValue: (kcv: string, instanceId: string) => Promise<void>;
  clearKeyStorage: (instanceId: string) => Promise<void>;
  // Session persistence operations
  getWrappingKey: (instanceId: string) => Promise<number[] | null>;
  setWrappingKey: (keyBytes: number[], instanceId: string) => Promise<void>;
  getWrappedKey: (instanceId: string) => Promise<number[] | null>;
  setWrappedKey: (wrappedKey: number[], instanceId: string) => Promise<void>;
  hasSession: (instanceId: string) => Promise<boolean>;
  clearSession: (instanceId: string) => Promise<void>;
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
