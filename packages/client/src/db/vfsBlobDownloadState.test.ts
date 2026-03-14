import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockEq = vi.fn((left: unknown, right: unknown) => ({ left, right }));
const mockGetDatabase = vi.fn();
const mockIsDatabaseInitialized = vi.fn();
const mockSelect = vi.fn();
const mockFrom = vi.fn();
const mockWhere = vi.fn();
const mockLimit = vi.fn();
const mockInsert = vi.fn();
const mockValues = vi.fn();
const mockOnConflictDoUpdate = vi.fn();

vi.mock('drizzle-orm', () => ({
  eq: (...args: unknown[]) => mockEq(...args)
}));

vi.mock('@/db', () => ({
  getDatabase: () => mockGetDatabase(),
  isDatabaseInitialized: () => mockIsDatabaseInitialized()
}));

vi.mock('@/db/schema', () => ({
  userSettings: {
    key: 'user_settings.key',
    value: 'user_settings.value'
  }
}));

import {
  loadVfsBlobDownloadState,
  saveVfsBlobDownloadState
} from './vfsBlobDownloadState';

const PERSISTED_STATE = {
  pendingDownloads: [
    {
      operationId: 'download:blob-1',
      blobId: 'blob-1',
      itemId: 'item-1',
      sizeBytes: 128
    }
  ]
};

describe('vfsBlobDownloadState', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    mockLimit.mockResolvedValue([]);
    mockWhere.mockReturnValue({ limit: mockLimit });
    mockFrom.mockReturnValue({ where: mockWhere });
    mockSelect.mockReturnValue({ from: mockFrom });
    mockOnConflictDoUpdate.mockResolvedValue(undefined);
    mockValues.mockReturnValue({
      onConflictDoUpdate: mockOnConflictDoUpdate
    });
    mockInsert.mockReturnValue({ values: mockValues });
    mockGetDatabase.mockReturnValue({
      select: mockSelect,
      insert: mockInsert
    });
    mockIsDatabaseInitialized.mockReturnValue(true);
  });

  it('returns null when the database is not initialized', async () => {
    mockIsDatabaseInitialized.mockReturnValue(false);

    await expect(
      loadVfsBlobDownloadState('user-1', 'client-1')
    ).resolves.toBeNull();
    await expect(
      saveVfsBlobDownloadState('user-1', 'client-1', PERSISTED_STATE)
    ).resolves.toBeUndefined();
    expect(mockGetDatabase).not.toHaveBeenCalled();
  });

  it('loads and parses persisted state from user settings', async () => {
    mockLimit.mockResolvedValueOnce([
      {
        value: JSON.stringify(PERSISTED_STATE)
      }
    ]);

    await expect(
      loadVfsBlobDownloadState('user-1', 'client-1')
    ).resolves.toEqual(PERSISTED_STATE);
    expect(mockEq).toHaveBeenCalledWith(
      'user_settings.key',
      'vfs_blob_download_state:user-1:client-1'
    );
  });

  it('returns null for missing or invalid persisted state payloads', async () => {
    mockLimit
      .mockResolvedValueOnce([{ value: null }])
      .mockResolvedValueOnce([{ value: '{invalid-json' }]);

    await expect(
      loadVfsBlobDownloadState('user-1', 'client-1')
    ).resolves.toBeNull();
    await expect(
      loadVfsBlobDownloadState('user-1', 'client-1')
    ).resolves.toBeNull();
  });

  it('swallows database transition errors and rethrows unexpected load failures', async () => {
    mockLimit
      .mockRejectedValueOnce(new Error('Database not initialized during switch'))
      .mockRejectedValueOnce(new Error('boom'));

    await expect(
      loadVfsBlobDownloadState('user-1', 'client-1')
    ).resolves.toBeNull();
    await expect(
      loadVfsBlobDownloadState('user-1', 'client-1')
    ).rejects.toThrow('boom');
  });

  it('persists state under the scoped user settings key', async () => {
    await expect(
      saveVfsBlobDownloadState('user-1', 'client-1', PERSISTED_STATE)
    ).resolves.toBeUndefined();

    expect(mockValues).toHaveBeenCalledWith({
      key: 'vfs_blob_download_state:user-1:client-1',
      value: JSON.stringify(PERSISTED_STATE),
      updatedAt: expect.any(Date)
    });
    expect(mockOnConflictDoUpdate).toHaveBeenCalledWith({
      target: 'user_settings.key',
      set: {
        value: JSON.stringify(PERSISTED_STATE),
        updatedAt: expect.any(Date)
      }
    });
  });

  it('swallows database transition errors and rethrows unexpected save failures', async () => {
    mockOnConflictDoUpdate
      .mockRejectedValueOnce(new Error('Database not initialized during save'))
      .mockRejectedValueOnce(new Error('write failed'));

    await expect(
      saveVfsBlobDownloadState('user-1', 'client-1', PERSISTED_STATE)
    ).resolves.toBeUndefined();
    await expect(
      saveVfsBlobDownloadState('user-1', 'client-1', PERSISTED_STATE)
    ).rejects.toThrow('write failed');
  });
});
