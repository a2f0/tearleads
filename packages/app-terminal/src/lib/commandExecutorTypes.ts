import type { PendingCommand } from './types';

/** Database context operations used by the executor */
export interface DatabaseOperations {
  isLoading: boolean;
  isSetUp: boolean;
  isUnlocked: boolean;
  hasPersistedSession: boolean;
  currentInstanceId?: string | null;
  currentInstanceName: string | null;
  instances?: ReadonlyArray<{ id: string; name: string }>;
  setup: (password: string) => Promise<boolean>;
  unlock: (password: string, persistSession?: boolean) => Promise<boolean>;
  restoreSession: () => Promise<boolean>;
  lock: (clearSession?: boolean) => Promise<void>;
  exportDatabase: () => Promise<Uint8Array>;
  importDatabase: (data: Uint8Array) => Promise<void>;
  changePassword: (
    oldPassword: string,
    newPassword: string
  ) => Promise<boolean>;
  switchInstance?: (instanceId: string) => Promise<boolean>;
  refreshInstances?: () => Promise<void>;
}

/** Terminal control functions */
export interface TerminalControl {
  appendLine: (
    content: string,
    type: 'command' | 'output' | 'error' | 'success'
  ) => void;
  clearLines: () => void;
  setPasswordMode: (prompt: string) => void;
  setConfirmMode: (prompt: string) => void;
  setCommandMode: () => void;
  setProcessing: (value: boolean) => void;
  setPendingCommand: (command: PendingCommand | null) => void;
}

/** File picker interface for restore command */
export interface FilePicker {
  pickFile: (accept: string) => Promise<File | null>;
}

/** Shared terminal utilities injected by the host app */
export interface TerminalUtilities {
  getErrorMessage: (error: unknown) => string;
  generateBackupFilename: () => string;
  readFileAsUint8Array: (file: File) => Promise<Uint8Array>;
  saveFile: (data: Uint8Array, filename: string) => Promise<void>;
}
