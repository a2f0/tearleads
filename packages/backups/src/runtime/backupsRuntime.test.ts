import { describe, expect, it, vi } from 'vitest';
import {
  type BackupsRuntime,
  configureBackupsRuntime,
  getBackupsRuntime
} from './backupsRuntime';

function createRuntimeMock(): BackupsRuntime {
  return {
    estimateBackupSize: vi.fn(),
    createBackup: vi.fn(),
    getBackupInfo: vi.fn(),
    restoreBackup: vi.fn(),
    refreshInstances: vi.fn(),
    isBackupStorageSupported: vi.fn(),
    listStoredBackups: vi.fn(),
    getBackupStorageUsed: vi.fn(),
    readBackupFromStorage: vi.fn(),
    deleteBackupFromStorage: vi.fn(),
    saveFile: vi.fn()
  };
}

describe('backupsRuntime', () => {
  it('throws before runtime is configured', () => {
    expect(() => getBackupsRuntime()).toThrow(
      'Backups runtime is not configured. Call configureBackupsRuntime() before rendering backups components.'
    );
  });

  it('returns configured runtime instance', () => {
    const runtime = createRuntimeMock();
    configureBackupsRuntime(runtime);

    expect(getBackupsRuntime()).toBe(runtime);
  });
});
