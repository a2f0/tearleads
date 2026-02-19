import { vi } from 'vitest';
import type {
  DatabaseOperations,
  FilePicker,
  TerminalControl,
  TerminalUtilities
} from './commandExecutor';

export interface CommandExecutorTestContext {
  db: DatabaseOperations;
  terminal: TerminalControl;
  filePicker: FilePicker;
  utilities: TerminalUtilities;
}

export function createCommandExecutorTestContext(): CommandExecutorTestContext {
  const db: DatabaseOperations = {
    isLoading: false,
    isSetUp: false,
    isUnlocked: false,
    hasPersistedSession: false,
    currentInstanceId: 'instance-default',
    currentInstanceName: 'Default',
    instances: [{ id: 'instance-default', name: 'Default' }],
    setup: vi.fn().mockResolvedValue(true),
    unlock: vi.fn().mockResolvedValue(true),
    restoreSession: vi.fn().mockResolvedValue(true),
    lock: vi.fn().mockResolvedValue(undefined),
    exportDatabase: vi.fn().mockResolvedValue(new Uint8Array([1, 2, 3])),
    importDatabase: vi.fn().mockResolvedValue(undefined),
    changePassword: vi.fn().mockResolvedValue(true),
    switchInstance: vi.fn().mockResolvedValue(true),
    refreshInstances: vi.fn().mockResolvedValue(undefined)
  };

  const terminal: TerminalControl = {
    appendLine: vi.fn(),
    clearLines: vi.fn(),
    setPasswordMode: vi.fn(),
    setConfirmMode: vi.fn(),
    setCommandMode: vi.fn(),
    setProcessing: vi.fn(),
    setPendingCommand: vi.fn()
  };

  const filePicker: FilePicker = {
    pickFile: vi.fn().mockResolvedValue(null)
  };

  const utilities: TerminalUtilities = {
    getErrorMessage: (error) =>
      error instanceof Error ? error.message : String(error),
    generateBackupFilename: vi.fn(() => 'tearleads-backup.db'),
    readFileAsUint8Array: vi.fn(() =>
      Promise.resolve(new Uint8Array([1, 2, 3]))
    ),
    saveFile: vi.fn(() => Promise.resolve())
  };

  return { db, terminal, filePicker, utilities };
}
