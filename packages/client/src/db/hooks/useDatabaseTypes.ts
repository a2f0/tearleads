import type { ReactNode } from 'react';
import type { Database } from '../index';
import type { InstanceMetadata } from '../instanceRegistry';

export interface DatabaseContextValue {
  db: Database | null;
  isLoading: boolean;
  error: Error | null;
  isSetUp: boolean;
  isUnlocked: boolean;
  hasPersistedSession: boolean;
  currentInstanceId: string | null;
  currentInstanceName: string | null;
  instances: InstanceMetadata[];
  setup: (password: string) => Promise<boolean>;
  unlock: (password: string, persistSession?: boolean) => Promise<boolean>;
  restoreSession: () => Promise<boolean>;
  persistSession: () => Promise<boolean>;
  clearPersistedSession: () => Promise<void>;
  lock: (clearSession?: boolean) => Promise<void>;
  changePassword: (
    oldPassword: string,
    newPassword: string
  ) => Promise<boolean>;
  reset: () => Promise<void>;
  exportDatabase: () => Promise<Uint8Array>;
  importDatabase: (data: Uint8Array) => Promise<void>;
  createInstance: () => Promise<string>;
  switchInstance: (instanceId: string) => Promise<boolean>;
  deleteInstance: (instanceId: string) => Promise<void>;
  refreshInstances: () => Promise<void>;
}

export interface DatabaseProviderProps {
  children: ReactNode;
}
