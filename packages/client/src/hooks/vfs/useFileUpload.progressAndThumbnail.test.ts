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
  computeContentHash: vi.fn(),
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

describe('useFileUpload progress and thumbnails', () => {
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

  it('calls progress callback at expected stages for non-image files', async () => {
    vi.mocked(fileTypeFromBuffer).mockResolvedValue({
      ext: 'pdf',
      mime: 'application/pdf'
    });
    vi.mocked(isThumbnailSupported).mockReturnValue(false);

    const onProgress = vi.fn();
    const { result } = renderHook(() => useFileUpload());
    const file = new File(['test'], 'test.pdf', { type: 'application/pdf' });

    await result.current.uploadFile(file, onProgress);

    expect(onProgress).toHaveBeenCalledWith(10);
    expect(onProgress).toHaveBeenCalledWith(30);
    expect(onProgress).toHaveBeenCalledWith(40);
    expect(onProgress).toHaveBeenCalledWith(50);
    expect(onProgress).toHaveBeenCalledWith(65);
    expect(onProgress).toHaveBeenCalledWith(85);
    expect(onProgress).toHaveBeenCalledWith(100);
  });

  it('calls progress callback at expected stages for image files with thumbnail', async () => {
    vi.mocked(fileTypeFromBuffer).mockResolvedValue({
      ext: 'png',
      mime: 'image/png'
    });
    vi.mocked(isThumbnailSupported).mockReturnValue(true);

    const onProgress = vi.fn();
    const { result } = renderHook(() => useFileUpload());
    const file = new File(['test'], 'test.png', { type: 'image/png' });

    await result.current.uploadFile(file, onProgress);

    expect(onProgress).toHaveBeenCalledWith(10);
    expect(onProgress).toHaveBeenCalledWith(30);
    expect(onProgress).toHaveBeenCalledWith(40);
    expect(onProgress).toHaveBeenCalledWith(50);
    expect(onProgress).toHaveBeenCalledWith(65);
    expect(onProgress).toHaveBeenCalledWith(85);
    expect(onProgress).toHaveBeenCalledWith(100);
  });

  it('generates thumbnail for supported image types', async () => {
    vi.mocked(fileTypeFromBuffer).mockResolvedValue({
      ext: 'png',
      mime: 'image/png'
    });
    vi.mocked(isThumbnailSupported).mockReturnValue(true);
    vi.mocked(generateThumbnail).mockResolvedValue(new Uint8Array([4, 5, 6]));

    const { result } = renderHook(() => useFileUpload());
    const file = new File(['test'], 'test.png', { type: 'image/png' });

    await result.current.uploadFile(file);

    expect(generateThumbnail).toHaveBeenCalledWith(
      new Uint8Array([1, 2, 3]),
      'image/png'
    );
    expect(mockStorage.measureStore).toHaveBeenCalledTimes(1);
    expect(mockStorage.store).toHaveBeenCalledTimes(1);
    expect(mockStorage.store).toHaveBeenCalledWith(
      'test-uuid-1234-thumb',
      new Uint8Array([4, 5, 6])
    );
  });

  it('does not generate thumbnail for unsupported types', async () => {
    vi.mocked(fileTypeFromBuffer).mockResolvedValue({
      ext: 'pdf',
      mime: 'application/pdf'
    });
    vi.mocked(isThumbnailSupported).mockReturnValue(false);

    const { result } = renderHook(() => useFileUpload());
    const file = new File(['test'], 'test.pdf', { type: 'application/pdf' });

    await result.current.uploadFile(file);

    expect(generateThumbnail).not.toHaveBeenCalled();
    expect(mockStorage.measureStore).toHaveBeenCalledTimes(1);
  });

  it('continues upload when thumbnail generation fails', async () => {
    const consoleSpy = mockConsoleWarn();
    vi.mocked(fileTypeFromBuffer).mockResolvedValue({
      ext: 'png',
      mime: 'image/png'
    });
    vi.mocked(isThumbnailSupported).mockReturnValue(true);
    vi.mocked(generateThumbnail).mockRejectedValue(
      new Error('Thumbnail failed')
    );

    const { result } = renderHook(() => useFileUpload());
    const file = new File(['test'], 'test.png', { type: 'image/png' });

    const uploadResult = await result.current.uploadFile(file);

    expect(uploadResult.id).toBe('test-uuid-1234');
    expect(uploadResult.isDuplicate).toBe(false);
    expect(mockStorage.measureStore).toHaveBeenCalledTimes(1);
    expect(consoleSpy).toHaveBeenCalledWith(
      'Failed to generate thumbnail for test.png:',
      expect.any(Error)
    );
    consoleSpy.mockRestore();
  });

  it('logs analytics event for thumbnail generation', async () => {
    vi.mocked(fileTypeFromBuffer).mockResolvedValue({
      ext: 'png',
      mime: 'image/png'
    });
    vi.mocked(isThumbnailSupported).mockReturnValue(true);

    const { result } = renderHook(() => useFileUpload());
    const file = new File(['test'], 'test.png', { type: 'image/png' });

    await result.current.uploadFile(file);

    expect(logEvent).toHaveBeenCalledWith(
      expect.anything(),
      'thumbnail_generation',
      expect.any(Number),
      true
    );
  });

  it('logs failed analytics event when thumbnail generation fails', async () => {
    const consoleSpy = mockConsoleWarn();
    vi.mocked(fileTypeFromBuffer).mockResolvedValue({
      ext: 'png',
      mime: 'image/png'
    });
    vi.mocked(isThumbnailSupported).mockReturnValue(true);
    vi.mocked(generateThumbnail).mockRejectedValue(
      new Error('Thumbnail failed')
    );

    const { result } = renderHook(() => useFileUpload());
    const file = new File(['test'], 'test.png', { type: 'image/png' });

    await result.current.uploadFile(file);

    expect(logEvent).toHaveBeenCalledWith(
      expect.anything(),
      'thumbnail_generation',
      expect.any(Number),
      false
    );
    expect(consoleSpy).toHaveBeenCalledWith(
      'Failed to generate thumbnail for test.png:',
      expect.any(Error)
    );
    consoleSpy.mockRestore();
  });
});
