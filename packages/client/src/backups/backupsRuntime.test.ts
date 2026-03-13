import { beforeEach, describe, expect, it, vi } from 'vitest';

const getCurrentInstanceIdMock = vi.fn();
const getDatabaseAdapterMock = vi.fn();
const createBackupMock = vi.fn();
const estimateBackupSizeMock = vi.fn();
const restoreBackupMock = vi.fn();
const getActiveInstanceMock = vi.fn();
const getActiveInstanceIdMock = vi.fn();
const emitInstanceChangeMock = vi.fn();
const saveFileMock = vi.fn();
const isBackupStorageSupportedMock = vi.fn();
const saveBackupToStorageMock = vi.fn();
const isFileStorageInitializedMock = vi.fn();
const getFileStorageForInstanceMock = vi.fn();
const getKeyManagerMock = vi.fn();
const initializeFileStorageMock = vi.fn();

vi.mock('@/db', () => ({
  getCurrentInstanceId: (...args: unknown[]) => getCurrentInstanceIdMock(...args),
  getDatabaseAdapter: (...args: unknown[]) => getDatabaseAdapterMock(...args)
}));

vi.mock('@/db/backup', () => ({
  createBackup: (...args: unknown[]) => createBackupMock(...args),
  estimateBackupSize: (...args: unknown[]) => estimateBackupSizeMock(...args),
  getBackupInfo: vi.fn(),
  restoreBackup: (...args: unknown[]) => restoreBackupMock(...args)
}));

vi.mock('@/db/crypto', () => ({
  getKeyManager: (...args: unknown[]) => getKeyManagerMock(...args)
}));

vi.mock('@/db/instanceRegistry', () => ({
  getActiveInstance: (...args: unknown[]) => getActiveInstanceMock(...args),
  getActiveInstanceId: (...args: unknown[]) => getActiveInstanceIdMock(...args)
}));

vi.mock('@/hooks/app', () => ({
  emitInstanceChange: (...args: unknown[]) => emitInstanceChangeMock(...args)
}));

vi.mock('@/lib/fileUtils', () => ({
  saveFile: (...args: unknown[]) => saveFileMock(...args)
}));

vi.mock('@/storage/backupStorage', () => ({
  deleteBackupFromStorage: vi.fn(),
  getBackupStorageUsed: vi.fn(),
  isBackupStorageSupported: (...args: unknown[]) => isBackupStorageSupportedMock(...args),
  listStoredBackups: vi.fn(),
  readBackupFromStorage: vi.fn(),
  saveBackupToStorage: (...args: unknown[]) => saveBackupToStorageMock(...args)
}));

vi.mock('@/storage/opfs', () => ({
  getFileStorageForInstance: (...args: unknown[]) => getFileStorageForInstanceMock(...args),
  initializeFileStorage: (...args: unknown[]) => initializeFileStorageMock(...args),
  isFileStorageInitialized: (...args: unknown[]) => isFileStorageInitializedMock(...args)
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

  it('passes progress callback through backup creation when provided', async () => {
    getCurrentInstanceIdMock.mockReturnValue('instance-1');
    const onProgress = vi.fn();

    await clientBackupsRuntime.createBackup({
      password: 'pw',
      includeBlobs: false,
      onProgress
    });

    expect(createBackupMock).toHaveBeenCalledWith('adapter', null, {
      password: 'pw',
      includeBlobs: false,
      instanceName: 'Primary',
      onProgress
    });
  });

  it('throws when no active instance is set for backup creation', async () => {
    getCurrentInstanceIdMock.mockReturnValue(null);

    await expect(
      clientBackupsRuntime.createBackup({
        password: 'pw',
        includeBlobs: false
      })
    ).rejects.toThrow('No active database instance');
  });

  it('initializes file storage when encryption key is available', async () => {
    const key = new Uint8Array([7, 8, 9]);
    getCurrentInstanceIdMock.mockReturnValue('instance-1');
    getKeyManagerMock.mockReturnValue({ getCurrentKey: () => key });
    initializeFileStorageMock.mockResolvedValue('file-storage');

    const result = await clientBackupsRuntime.createBackup({
      password: 'pw',
      includeBlobs: true
    });

    expect(initializeFileStorageMock).toHaveBeenCalledWith(key, 'instance-1');
    expect(createBackupMock).toHaveBeenCalledWith('adapter', 'file-storage', {
      password: 'pw',
      includeBlobs: true,
      instanceName: 'Primary'
    });
    expect(result.destination).toBe('storage');
  });

  it('uses Unknown instance name when active instance cannot be resolved', async () => {
    getCurrentInstanceIdMock.mockReturnValue('instance-1');
    getActiveInstanceMock.mockResolvedValue(null);

    await clientBackupsRuntime.createBackup({
      password: 'pw',
      includeBlobs: false
    });

    expect(createBackupMock).toHaveBeenCalledWith('adapter', null, {
      password: 'pw',
      includeBlobs: false,
      instanceName: 'Unknown'
    });
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

  it('falls back to download when storage save throws synchronously', async () => {
    getCurrentInstanceIdMock.mockReturnValue('instance-1');
    saveBackupToStorageMock.mockImplementation(() => {
      throw new Error('sync save failure');
    });

    const result = await clientBackupsRuntime.createBackup({
      password: 'pw',
      includeBlobs: false
    });

    expect(saveFileMock).toHaveBeenCalledTimes(1);
    expect(result.destination).toBe('download');
  });

  it('falls back to download when storage save times out', async () => {
    vi.useFakeTimers();
    try {
      getCurrentInstanceIdMock.mockReturnValue('instance-1');
      saveBackupToStorageMock.mockImplementation(
        () => new Promise<void>(() => {})
      );

      const backupPromise = clientBackupsRuntime.createBackup({
        password: 'pw',
        includeBlobs: false
      });
      await vi.advanceTimersByTimeAsync(15000);

      const result = await backupPromise;
      expect(saveFileMock).toHaveBeenCalledTimes(1);
      expect(result.destination).toBe('download');
    } finally {
      vi.useRealTimers();
    }
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

  it('omits progress handler when restore input does not provide it', async () => {
    await clientBackupsRuntime.restoreBackup({
      backupData: new Uint8Array([2]),
      backupPassword: 'old',
      newInstancePassword: 'new'
    });

    expect(restoreBackupMock).toHaveBeenCalledWith({
      backupData: new Uint8Array([2]),
      backupPassword: 'old',
      newInstancePassword: 'new'
    });
  });

  it('emits instance refresh event for active instance', async () => {
    getActiveInstanceIdMock.mockResolvedValue('instance-2');

    await clientBackupsRuntime.refreshInstances();

    expect(emitInstanceChangeMock).toHaveBeenCalledWith('instance-2');
  });
});
