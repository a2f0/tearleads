import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { UnsupportedFileTypeError } from '@/lib/errors';
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

vi.mock('@/contexts/VfsOrchestratorContext', () => ({
  useVfsOrchestratorInstance: vi.fn(() => null),
  useVfsSecureFacade: vi.fn(() => null)
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

describe('useFileUpload error handling and deduplication', () => {
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
  });

  it('throws error when database is not unlocked', async () => {
    vi.mocked(getKeyManager).mockReturnValue({
      getCurrentKey: () => null
    } as unknown as ReturnType<typeof getKeyManager>);

    const { result } = renderHook(() => useFileUpload());
    const file = new File(['test'], 'test.png');

    await expect(result.current.uploadFile(file)).rejects.toThrow(
      'Database not unlocked'
    );
  });

  it('throws error when file read fails', async () => {
    vi.mocked(readFileAsUint8Array).mockRejectedValue(
      new Error('Failed to read file')
    );

    const { result } = renderHook(() => useFileUpload());
    const file = new File(['test'], 'test.png', { type: 'image/png' });

    await expect(result.current.uploadFile(file)).rejects.toThrow(
      'Failed to read file'
    );
  });

  it('throws error when storage fails', async () => {
    vi.mocked(fileTypeFromBuffer).mockResolvedValue({
      ext: 'png',
      mime: 'image/png'
    });
    vi.mocked(mockStorage.measureStore).mockRejectedValue(
      new Error('Storage quota exceeded')
    );

    const { result } = renderHook(() => useFileUpload());
    const file = new File(['test'], 'test.png', { type: 'image/png' });

    await expect(result.current.uploadFile(file)).rejects.toThrow(
      'Storage quota exceeded'
    );
  });

  it('throws UnsupportedFileTypeError with descriptive message', async () => {
    vi.mocked(fileTypeFromBuffer).mockResolvedValue(undefined);

    const { result } = renderHook(() => useFileUpload());
    const file = new File(['unknown data'], 'mystery_file.xyz', {
      type: 'application/octet-stream'
    });

    await expect(result.current.uploadFile(file)).rejects.toThrow(
      'Unable to detect file type for "mystery_file.xyz". Only files with recognizable formats are supported.'
    );
  });

  it('throws UnsupportedFileTypeError for non-text files with no magic bytes', async () => {
    vi.mocked(fileTypeFromBuffer).mockResolvedValue(undefined);

    const { result } = renderHook(() => useFileUpload());
    const file = new File(['random binary data'], 'mystery.dat', {
      type: 'application/octet-stream'
    });

    await expect(result.current.uploadFile(file)).rejects.toBeInstanceOf(
      UnsupportedFileTypeError
    );
  });

  it('returns existing file ID for duplicate content', async () => {
    vi.mocked(fileTypeFromBuffer).mockResolvedValue({
      ext: 'png',
      mime: 'image/png'
    });
    mockDb.select.mockImplementationOnce(() => ({
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue([{ id: 'existing-file-id' }])
    }));

    const { result } = renderHook(() => useFileUpload());
    const file = new File(['duplicate-content'], 'copy.png', {
      type: 'image/png'
    });

    const uploadResult = await result.current.uploadFile(file);

    expect(uploadResult.id).toBe('existing-file-id');
    expect(uploadResult.isDuplicate).toBe(true);
    expect(mockStorage.measureStore).not.toHaveBeenCalled();
  });
});
