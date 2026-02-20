import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  getCurrentInstanceIdMock,
  getDatabaseAdapterMock,
  createBackupMock,
  estimateBackupSizeMock,
  restoreBackupMock,
  getActiveInstanceMock,
  getActiveInstanceIdMock,
  emitInstanceChangeMock,
  saveFileMock,
  isBackupStorageSupportedMock,
  saveBackupToStorageMock,
  isFileStorageInitializedMock,
  getFileStorageForInstanceMock,
  getKeyManagerMock,
  initializeFileStorageMock
} = vi.hoisted(() => ({
  getCurrentInstanceIdMock: vi.fn(),
  getDatabaseAdapterMock: vi.fn(),
  createBackupMock: vi.fn(),
  estimateBackupSizeMock: vi.fn(),
  restoreBackupMock: vi.fn(),
  getActiveInstanceMock: vi.fn(),
  getActiveInstanceIdMock: vi.fn(),
  emitInstanceChangeMock: vi.fn(),
  saveFileMock: vi.fn(),
  isBackupStorageSupportedMock: vi.fn(),
  saveBackupToStorageMock: vi.fn(),
  isFileStorageInitializedMock: vi.fn(),
  getFileStorageForInstanceMock: vi.fn(),
  getKeyManagerMock: vi.fn(),
  initializeFileStorageMock: vi.fn()
}));

vi.mock('@/db', () => ({
  getCurrentInstanceId: getCurrentInstanceIdMock,
  getDatabaseAdapter: getDatabaseAdapterMock
}));

vi.mock('@/db/backup', () => ({
  createBackup: createBackupMock,
  estimateBackupSize: estimateBackupSizeMock,
  getBackupInfo: vi.fn(),
  restoreBackup: restoreBackupMock
}));

vi.mock('@/db/crypto', () => ({
  getKeyManager: getKeyManagerMock
}));

vi.mock('@/db/instanceRegistry', () => ({
  getActiveInstance: getActiveInstanceMock,
  getActiveInstanceId: getActiveInstanceIdMock
}));

vi.mock('@/hooks/app', () => ({
  emitInstanceChange: emitInstanceChangeMock
}));

vi.mock('@/lib/fileUtils', () => ({
  saveFile: saveFileMock
}));

vi.mock('@/storage/backupStorage', () => ({
  deleteBackupFromStorage: vi.fn(),
  getBackupStorageUsed: vi.fn(),
  isBackupStorageSupported: isBackupStorageSupportedMock,
  listStoredBackups: vi.fn(),
  readBackupFromStorage: vi.fn(),
  saveBackupToStorage: saveBackupToStorageMock
}));

vi.mock('@/storage/opfs', () => ({
  getFileStorageForInstance: getFileStorageForInstanceMock,
  initializeFileStorage: initializeFileStorageMock,
  isFileStorageInitialized: isFileStorageInitializedMock
}));

import { clientBackupsRuntime } from './backupsRuntime';

describe('clientBackupsRuntime', () => {
  beforeEach(() => {
    getCurrentInstanceIdMock.mockReset();
    getDatabaseAdapterMock.mockReset();
    createBackupMock.mockReset();
    estimateBackupSizeMock.mockReset();
    restoreBackupMock.mockReset();
    getActiveInstanceMock.mockReset();
    getActiveInstanceIdMock.mockReset();
    emitInstanceChangeMock.mockReset();
    saveFileMock.mockReset();
    isBackupStorageSupportedMock.mockReset();
    saveBackupToStorageMock.mockReset();
    isFileStorageInitializedMock.mockReset();
    getFileStorageForInstanceMock.mockReset();
    getKeyManagerMock.mockReset();
    initializeFileStorageMock.mockReset();

    getDatabaseAdapterMock.mockReturnValue('adapter');
    getActiveInstanceMock.mockResolvedValue({ name: 'Primary' });
    createBackupMock.mockResolvedValue(new Uint8Array([1, 2, 3]));
    estimateBackupSizeMock.mockResolvedValue({
      blobCount: 2,
      blobTotalSize: 42
    });
    getKeyManagerMock.mockReturnValue({ getCurrentKey: () => null });
    isFileStorageInitializedMock.mockReturnValue(false);
    isBackupStorageSupportedMock.mockReturnValue(true);
  });

  it('throws when no active instance is set for size estimate', async () => {
    getCurrentInstanceIdMock.mockReturnValue(null);

    await expect(clientBackupsRuntime.estimateBackupSize(true)).rejects.toThrow(
      'No active database instance'
    );
  });

  it('uses existing file storage for size estimate', async () => {
    getCurrentInstanceIdMock.mockReturnValue('instance-1');
    isFileStorageInitializedMock.mockReturnValue(true);
    getFileStorageForInstanceMock.mockReturnValue('file-storage');

    const result = await clientBackupsRuntime.estimateBackupSize(true);

    expect(estimateBackupSizeMock).toHaveBeenCalledWith(
      'adapter',
      'file-storage',
      true
    );
    expect(result).toEqual({ blobCount: 2, blobTotalSize: 42 });
  });

  it('saves backup to app storage when supported', async () => {
    getCurrentInstanceIdMock.mockReturnValue('instance-1');

    const result = await clientBackupsRuntime.createBackup({
      password: 'pw',
      includeBlobs: true
    });

    expect(createBackupMock).toHaveBeenCalledWith('adapter', null, {
      password: 'pw',
      includeBlobs: false,
      instanceName: 'Primary'
    });
    expect(saveBackupToStorageMock).toHaveBeenCalledTimes(1);
    expect(result.destination).toBe('storage');
  });

  it('downloads backup when storage support is unavailable', async () => {
    getCurrentInstanceIdMock.mockReturnValue('instance-1');
    isBackupStorageSupportedMock.mockReturnValue(false);

    const result = await clientBackupsRuntime.createBackup({
      password: 'pw',
      includeBlobs: false
    });

    expect(saveFileMock).toHaveBeenCalledTimes(1);
    expect(result.destination).toBe('download');
  });

  it('falls back to download when storage save fails', async () => {
    getCurrentInstanceIdMock.mockReturnValue('instance-1');
    saveBackupToStorageMock.mockRejectedValue(new Error('save failed'));

    const result = await clientBackupsRuntime.createBackup({
      password: 'pw',
      includeBlobs: false
    });

    expect(saveBackupToStorageMock).toHaveBeenCalledTimes(1);
    expect(saveFileMock).toHaveBeenCalledTimes(1);
    expect(result.destination).toBe('download');
  });

  it('passes progress handler through restoreBackup', async () => {
    const onProgress = vi.fn();

    await clientBackupsRuntime.restoreBackup({
      backupData: new Uint8Array([1]),
      backupPassword: 'old',
      newInstancePassword: 'new',
      onProgress
    });

    expect(restoreBackupMock).toHaveBeenCalledWith({
      backupData: new Uint8Array([1]),
      backupPassword: 'old',
      newInstancePassword: 'new',
      onProgress
    });
  });

  it('emits instance refresh event for active instance', async () => {
    getActiveInstanceIdMock.mockResolvedValue('instance-2');

    await clientBackupsRuntime.refreshInstances();

    expect(emitInstanceChangeMock).toHaveBeenCalledWith('instance-2');
  });
});
