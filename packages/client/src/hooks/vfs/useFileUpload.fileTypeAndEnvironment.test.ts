import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { UnsupportedFileTypeError } from '@/lib/errors';
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
import { getCurrentInstanceId, getKeyManager } from '@/db/crypto';
import { isLoggedIn } from '@/lib/authStorage';
import {
  computeContentHashStreaming,
  readFileAsUint8Array
} from '@/lib/fileUtils';
import { generateThumbnail, isThumbnailSupported } from '@/lib/thumbnail';
import {
  getFileStorage,
  initializeFileStorage,
  isFileStorageInitialized
} from '@/storage/opfs';
import { generateSessionKey, wrapSessionKey } from './useVfsKeys';

describe('useFileUpload file type and environment', () => {
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
    vi.mocked(computeContentHashStreaming).mockResolvedValue('mock-hash');
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

  it('throws UnsupportedFileTypeError when file type cannot be detected', async () => {
    vi.mocked(fileTypeFromBuffer).mockResolvedValue(undefined);

    const { result } = renderHook(() => useFileUpload());
    const file = new File(['test'], 'unknown.bin', {
      type: 'application/octet-stream'
    });

    await expect(result.current.uploadFile(file)).rejects.toThrow(
      UnsupportedFileTypeError
    );
    await expect(result.current.uploadFile(file)).rejects.toThrow(
      'Unable to detect file type for "unknown.bin"'
    );
  });

  it('successfully uploads text files using browser-provided MIME type', async () => {
    vi.mocked(fileTypeFromBuffer).mockResolvedValue(undefined);

    const { result } = renderHook(() => useFileUpload());
    const file = new File(['Hello, world!'], 'notes.txt', {
      type: 'text/plain'
    });

    const uploadResult = await result.current.uploadFile(file);

    expect(uploadResult.id).toBe('test-uuid-1234');
    expect(uploadResult.isDuplicate).toBe(false);
    expect(mockDb.insert).toHaveBeenCalled();
  });

  it.each([
    { ext: 'png', mime: 'image/png', name: 'image.png', data: 'fake-png-data' },
    {
      ext: 'jpg',
      mime: 'image/jpeg',
      name: 'photo.jpg',
      data: 'fake-jpeg-data'
    },
    {
      ext: 'pdf',
      mime: 'application/pdf',
      name: 'document.pdf',
      data: 'fake-pdf-data'
    }
  ])('successfully uploads when file type is detected as $ext', async ({
    ext,
    mime,
    name,
    data
  }) => {
    vi.mocked(fileTypeFromBuffer).mockResolvedValue({ ext, mime });

    const { result } = renderHook(() => useFileUpload());
    const file = new File([data], name, { type: mime });

    const uploadResult = await result.current.uploadFile(file);

    expect(uploadResult.isDuplicate).toBe(false);
    expect(mockDb.insert).toHaveBeenCalled();
  });

  it('uses detected MIME type instead of browser-provided type', async () => {
    vi.mocked(fileTypeFromBuffer).mockResolvedValue({
      ext: 'png',
      mime: 'image/png'
    });

    const { result } = renderHook(() => useFileUpload());
    const file = new File(['fake-png-data'], 'suspicious.txt', {
      type: 'text/plain'
    });

    await result.current.uploadFile(file);

    expect(mockDb.insert).toHaveBeenCalled();
  });

  it.each([
    {
      type: 'HEIC',
      mime: 'image/heic',
      data: 'fake-heic-data',
      name: 'IMG_1234.HEIC'
    },
    {
      type: 'HEIF',
      mime: 'image/heif',
      data: 'fake-heif-data',
      name: 'photo.heif'
    }
  ])('uploads when file type is detected as $type', async ({
    type,
    mime,
    data,
    name
  }) => {
    vi.mocked(fileTypeFromBuffer).mockResolvedValue({
      ext: type.toLowerCase(),
      mime
    });
    vi.mocked(isThumbnailSupported).mockReturnValue(false);

    const { result } = renderHook(() => useFileUpload());
    const file = new File([data], name, { type: mime });

    const uploadResult = await result.current.uploadFile(file);

    expect(uploadResult.isDuplicate).toBe(false);
    expect(mockDb.insert).toHaveBeenCalled();
    expect(mockStorage.measureStore).toHaveBeenCalledTimes(1);
    expect(generateThumbnail).not.toHaveBeenCalled();
  });

  it('throws when no active instance is available', async () => {
    vi.mocked(getCurrentInstanceId).mockReturnValue(null);
    vi.mocked(fileTypeFromBuffer).mockResolvedValue({
      ext: 'png',
      mime: 'image/png'
    });

    const { result } = renderHook(() => useFileUpload());
    const file = new File(['fake-png-data'], 'image.png', {
      type: 'image/png'
    });

    await expect(result.current.uploadFile(file)).rejects.toThrow(
      'No active instance'
    );
  });

  it('initializes storage when not already initialized', async () => {
    vi.mocked(isFileStorageInitialized).mockReturnValue(false);
    vi.mocked(fileTypeFromBuffer).mockResolvedValue({
      ext: 'png',
      mime: 'image/png'
    });

    const { result } = renderHook(() => useFileUpload());
    const file = new File(['fake-png-data'], 'image.png', {
      type: 'image/png'
    });

    await result.current.uploadFile(file);

    expect(initializeFileStorage).toHaveBeenCalledWith(
      mockEncryptionKey,
      'test-instance'
    );
  });

  it('logs a warning when thumbnail analytics fail', async () => {
    const warnSpy = mockConsoleWarn();
    vi.mocked(fileTypeFromBuffer).mockResolvedValue({
      ext: 'png',
      mime: 'image/png'
    });
    vi.mocked(isThumbnailSupported).mockReturnValue(true);
    vi.mocked(generateThumbnail).mockResolvedValue(new Uint8Array([1, 2, 3]));
    vi.mocked(logEvent).mockRejectedValue(new Error('log failed'));

    const { result } = renderHook(() => useFileUpload());
    const file = new File(['fake-png-data'], 'image.png', {
      type: 'image/png'
    });

    await result.current.uploadFile(file);

    expect(warnSpy).toHaveBeenCalledWith(
      'Failed to log thumbnail_generation event:',
      expect.any(Error)
    );
    warnSpy.mockRestore();
  });

  it('skips storing thumbnails when none are generated', async () => {
    vi.mocked(fileTypeFromBuffer).mockResolvedValue({
      ext: 'png',
      mime: 'image/png'
    });
    vi.mocked(isThumbnailSupported).mockReturnValue(true);
    vi.mocked(generateThumbnail).mockResolvedValue(null);

    const { result } = renderHook(() => useFileUpload());
    const file = new File(['fake-png-data'], 'image.png', {
      type: 'image/png'
    });

    await result.current.uploadFile(file);

    expect(mockStorage.store).not.toHaveBeenCalled();
  });
});
