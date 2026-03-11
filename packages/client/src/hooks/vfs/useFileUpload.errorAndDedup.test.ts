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
  computeContentHashStreaming: vi.fn(),
  readMagicBytes: vi.fn(() =>
    Promise.resolve(new Uint8Array([0xff, 0xd8, 0xff]))
  ),
  createStreamFromFile: vi.fn(
    () =>
      new ReadableStream({
        start(controller) {
          controller.enqueue(new Uint8Array([1, 2, 3]));
          controller.close();
        }
      })
  )
}));

vi.mock('@/lib/thumbnail', () => ({
  generateThumbnail: vi.fn(),
  isThumbnailSupported: vi.fn()
}));

vi.mock('@/db/analytics', () => ({
  logEvent: vi.fn(),
  logApiEvent: vi.fn()
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
import {
  computeContentHashStreaming,
  readFileAsUint8Array
} from '@/lib/fileUtils';
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

    getKeyManager.mockReturnValue({
      getCurrentKey: () => mockEncryptionKey
    } as ReturnType<typeof getKeyManager>);
    isFileStorageInitialized.mockReturnValue(true);
    getDatabase.mockReturnValue(
      mockDb as unknown as ReturnType<typeof getDatabase>
    );
    getFileStorage.mockReturnValue(
      mockStorage as unknown as ReturnType<typeof getFileStorage>
    );
    readFileAsUint8Array.mockResolvedValue(new Uint8Array([1, 2, 3]));
    computeContentHashStreaming.mockResolvedValue('mock-hash');
    mockStorage.measureStore.mockResolvedValue('storage/path');
    isThumbnailSupported.mockReturnValue(false);
    generateThumbnail.mockResolvedValue(new Uint8Array([1, 2, 3]));
    logEvent.mockResolvedValue(undefined);

    vi.stubGlobal('crypto', {
      randomUUID: () => 'test-uuid-1234'
    });

    isLoggedIn.mockReturnValue(false);
    generateSessionKey.mockReturnValue(new Uint8Array(32));
    wrapSessionKey.mockResolvedValue('wrapped-key');
  });

  it('throws error when database is not unlocked', async () => {
    getKeyManager.mockReturnValue({
      getCurrentKey: () => null
    } as unknown as ReturnType<typeof getKeyManager>);

    const { result } = renderHook(() => useFileUpload());
    const file = new File(['test'], 'test.png');

    await expect(result.current.uploadFile(file)).rejects.toThrow(
      'Database not unlocked'
    );
  });

  it('throws error when file read fails', async () => {
    fileTypeFromBuffer.mockResolvedValue({
      ext: 'png',
      mime: 'image/png'
    });
    readFileAsUint8Array.mockRejectedValue(new Error('Failed to read file'));

    const { result } = renderHook(() => useFileUpload());
    const file = new File(['test'], 'test.png', { type: 'image/png' });

    await expect(result.current.uploadFile(file)).rejects.toThrow(
      'Failed to read file'
    );
  });

  it('throws error when storage fails', async () => {
    fileTypeFromBuffer.mockResolvedValue({
      ext: 'png',
      mime: 'image/png'
    });
    mockStorage.measureStore.mockRejectedValue(
      new Error('Storage quota exceeded')
    );

    const { result } = renderHook(() => useFileUpload());
    const file = new File(['test'], 'test.png', { type: 'image/png' });

    await expect(result.current.uploadFile(file)).rejects.toThrow(
      'Storage quota exceeded'
    );
  });

  it('throws UnsupportedFileTypeError with descriptive message', async () => {
    fileTypeFromBuffer.mockResolvedValue(undefined);

    const { result } = renderHook(() => useFileUpload());
    const file = new File(['unknown data'], 'mystery_file.xyz', {
      type: 'application/octet-stream'
    });

    await expect(result.current.uploadFile(file)).rejects.toThrow(
      'Unable to detect file type for "mystery_file.xyz". Only files with recognizable formats are supported.'
    );
  });

  it('throws UnsupportedFileTypeError for non-text files with no magic bytes', async () => {
    fileTypeFromBuffer.mockResolvedValue(undefined);

    const { result } = renderHook(() => useFileUpload());
    const file = new File(['random binary data'], 'mystery.dat', {
      type: 'application/octet-stream'
    });

    await expect(result.current.uploadFile(file)).rejects.toBeInstanceOf(
      UnsupportedFileTypeError
    );
  });

  it('returns existing file ID for duplicate content', async () => {
    fileTypeFromBuffer.mockResolvedValue({
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
    expect(readFileAsUint8Array).not.toHaveBeenCalled();
    expect(mockStorage.measureStore).not.toHaveBeenCalled();
  });
});
