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
    measureStoreBlob: vi.fn(),
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
    mockStorage.measureStoreBlob.mockResolvedValue('storage/path');
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

  it('throws UnsupportedFileTypeError when file type cannot be detected', async () => {
    fileTypeFromBuffer.mockResolvedValue(undefined);

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
    fileTypeFromBuffer.mockResolvedValue(undefined);

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
    fileTypeFromBuffer.mockResolvedValue({ ext, mime });

    const { result } = renderHook(() => useFileUpload());
    const file = new File([data], name, { type: mime });

    const uploadResult = await result.current.uploadFile(file);

    expect(uploadResult.isDuplicate).toBe(false);
    expect(mockDb.insert).toHaveBeenCalled();
  });

  it('successfully uploads SVG files using browser-provided MIME type', async () => {
    fileTypeFromBuffer.mockResolvedValue(undefined);

    const { result } = renderHook(() => useFileUpload());
    const file = new File(
      ['<svg xmlns="http://www.w3.org/2000/svg"><rect/></svg>'],
      'icon.svg',
      { type: 'image/svg+xml' }
    );

    const uploadResult = await result.current.uploadFile(file);

    expect(uploadResult.id).toBe('test-uuid-1234');
    expect(uploadResult.isDuplicate).toBe(false);
    expect(mockDb.insert).toHaveBeenCalled();
  });

  it('uses detected MIME type instead of browser-provided type', async () => {
    fileTypeFromBuffer.mockResolvedValue({
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
    fileTypeFromBuffer.mockResolvedValue({
      ext: type.toLowerCase(),
      mime
    });
    isThumbnailSupported.mockReturnValue(false);

    const { result } = renderHook(() => useFileUpload());
    const file = new File([data], name, { type: mime });

    const uploadResult = await result.current.uploadFile(file);

    expect(uploadResult.isDuplicate).toBe(false);
    expect(mockDb.insert).toHaveBeenCalled();
    expect(mockStorage.measureStore).toHaveBeenCalledTimes(1);
    expect(generateThumbnail).not.toHaveBeenCalled();
  });

  it('throws when no active instance is available', async () => {
    getCurrentInstanceId.mockReturnValue(null);
    fileTypeFromBuffer.mockResolvedValue({
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
    isFileStorageInitialized.mockReturnValue(false);
    fileTypeFromBuffer.mockResolvedValue({
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

  it('uses streaming local storage for large files without thumbnail buffers', async () => {
    fileTypeFromBuffer.mockResolvedValue({
      ext: 'pdf',
      mime: 'application/pdf'
    });
    isThumbnailSupported.mockReturnValue(false);

    const largeFile = new File(
      [new Uint8Array(17 * 1024 * 1024)],
      'large.pdf',
      { type: 'application/pdf' }
    );

    const { result } = renderHook(() => useFileUpload());

    await result.current.uploadFile(largeFile);

    expect(mockStorage.measureStoreBlob).toHaveBeenCalledTimes(1);
    expect(mockStorage.measureStoreBlob).toHaveBeenCalledWith(
      'test-uuid-1234',
      largeFile,
      expect.any(Function)
    );
    expect(readFileAsUint8Array).not.toHaveBeenCalled();
    expect(mockStorage.measureStore).not.toHaveBeenCalled();
  });

  it('logs a warning when thumbnail analytics fail', async () => {
    const warnSpy = mockConsoleWarn();
    fileTypeFromBuffer.mockResolvedValue({
      ext: 'png',
      mime: 'image/png'
    });
    isThumbnailSupported.mockReturnValue(true);
    generateThumbnail.mockResolvedValue(new Uint8Array([1, 2, 3]));
    logEvent.mockRejectedValue(new Error('log failed'));

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
    fileTypeFromBuffer.mockResolvedValue({
      ext: 'png',
      mime: 'image/png'
    });
    isThumbnailSupported.mockReturnValue(true);
    generateThumbnail.mockResolvedValue(null);

    const { result } = renderHook(() => useFileUpload());
    const file = new File(['fake-png-data'], 'image.png', {
      type: 'image/png'
    });

    await result.current.uploadFile(file);

    expect(mockStorage.store).not.toHaveBeenCalled();
  });
});
