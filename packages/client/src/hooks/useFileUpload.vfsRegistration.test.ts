import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mockConsoleWarn } from '@/test/consoleMocks';
import { useFileUpload } from './useFileUpload';

vi.mock('file-type', () => ({
  fileTypeFromBuffer: vi.fn()
}));

vi.mock('@/db', () => ({
  getDatabase: vi.fn()
}));

vi.mock('@/db/crypto', () => ({
  getKeyManager: vi.fn(),
  getCurrentInstanceId: vi.fn(() => 'test-instance')
}));

vi.mock('@/lib/fileUtils', () => ({
  readFileAsUint8Array: vi.fn(),
  computeContentHash: vi.fn()
}));

vi.mock('@/lib/thumbnail', () => ({
  generateThumbnail: vi.fn(),
  isThumbnailSupported: vi.fn()
}));

vi.mock('@/db/analytics', () => ({
  logEvent: vi.fn()
}));

vi.mock('@/storage/opfs', () => ({
  getFileStorage: vi.fn(),
  initializeFileStorage: vi.fn(),
  isFileStorageInitialized: vi.fn(),
  createStoreLogger: vi.fn(() => vi.fn())
}));

vi.mock('@/lib/authStorage', () => ({
  isLoggedIn: vi.fn(),
  readStoredAuth: vi.fn(() => ({ user: { id: 'test-user-id' } }))
}));

vi.mock('@/lib/featureFlags', () => ({
  getFeatureFlagValue: vi.fn(() => false)
}));

vi.mock('./useVfsKeys', () => ({
  generateSessionKey: vi.fn(),
  wrapSessionKey: vi.fn()
}));

import { fileTypeFromBuffer } from 'file-type';
import { getDatabase } from '@/db';
import { logEvent } from '@/db/analytics';
import { getKeyManager } from '@/db/crypto';
import { isLoggedIn } from '@/lib/authStorage';
import { computeContentHash, readFileAsUint8Array } from '@/lib/fileUtils';
import { generateThumbnail, isThumbnailSupported } from '@/lib/thumbnail';
import { getFileStorage, isFileStorageInitialized } from '@/storage/opfs';
import { generateSessionKey, wrapSessionKey } from './useVfsKeys';

describe('useFileUpload VFS registration', () => {
  const mockEncryptionKey = new Uint8Array(32);
  const mockStorage = {
    store: vi.fn(),
    measureStore: vi.fn(),
    delete: vi.fn()
  };

  const createMockSelectQuery = (result: unknown[]) => ({
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    limit: vi.fn().mockResolvedValue(result)
  });

  const createMockInsertQuery = () => ({
    values: vi.fn().mockResolvedValue(undefined)
  });

  const createMockDeleteQuery = () => ({
    where: vi.fn().mockResolvedValue(undefined)
  });

  let mockSelectResult: unknown[] = [];

  const mockDb = {
    select: vi.fn(() => createMockSelectQuery(mockSelectResult)),
    insert: vi.fn(() => createMockInsertQuery()),
    delete: vi.fn(() => createMockDeleteQuery())
  };

  beforeEach(() => {
    vi.resetAllMocks();
    mockSelectResult = [];

    vi.mocked(getKeyManager).mockReturnValue({
      getCurrentKey: () => mockEncryptionKey
    } as ReturnType<typeof getKeyManager>);
    vi.mocked(isFileStorageInitialized).mockReturnValue(true);
    vi.mocked(getDatabase).mockReturnValue(
      mockDb as unknown as ReturnType<typeof getDatabase>
    );
    vi.mocked(getFileStorage).mockReturnValue(
      mockStorage as unknown as ReturnType<typeof getFileStorage>
    );
    vi.mocked(readFileAsUint8Array).mockResolvedValue(
      new Uint8Array([1, 2, 3])
    );
    vi.mocked(computeContentHash).mockResolvedValue('mock-hash');
    vi.mocked(mockStorage.measureStore).mockResolvedValue('storage/path');
    vi.mocked(isThumbnailSupported).mockReturnValue(false);
    vi.mocked(generateThumbnail).mockResolvedValue(new Uint8Array([1, 2, 3]));
    vi.mocked(logEvent).mockResolvedValue(undefined);

    vi.stubGlobal('crypto', {
      randomUUID: () => 'test-uuid-1234'
    });

    vi.mocked(isLoggedIn).mockReturnValue(false);
    vi.mocked(generateSessionKey).mockReturnValue(new Uint8Array(32));
    vi.mocked(wrapSessionKey).mockResolvedValue('wrapped-key');
    vi.mocked(fileTypeFromBuffer).mockResolvedValue({
      ext: 'png',
      mime: 'image/png'
    });
  });

  it('still registers locally when user is not logged in', async () => {
    vi.mocked(isLoggedIn).mockReturnValue(false);

    const { result } = renderHook(() => useFileUpload());
    const file = new File(['test'], 'test.png', { type: 'image/png' });

    await result.current.uploadFile(file);

    expect(mockDb.insert).toHaveBeenCalled();
  });

  it('wraps session keys when user is logged in', async () => {
    vi.mocked(isLoggedIn).mockReturnValue(true);

    const { result } = renderHook(() => useFileUpload());
    const file = new File(['test'], 'test.png', { type: 'image/png' });

    await result.current.uploadFile(file);

    expect(generateSessionKey).toHaveBeenCalled();
    expect(wrapSessionKey).toHaveBeenCalled();
  });

  it('still saves locally when session key wrapping fails', async () => {
    const consoleSpy = mockConsoleWarn();
    vi.mocked(isLoggedIn).mockReturnValue(true);
    vi.mocked(wrapSessionKey).mockRejectedValue(new Error('VFS error'));

    const { result } = renderHook(() => useFileUpload());
    const file = new File(['test'], 'test.png', { type: 'image/png' });

    await result.current.uploadFile(file);

    expect(consoleSpy).toHaveBeenCalledWith(
      'Failed to wrap file session key:',
      expect.any(Error)
    );
    expect(mockDb.insert).toHaveBeenCalled();
    consoleSpy.mockRestore();
  });
});
