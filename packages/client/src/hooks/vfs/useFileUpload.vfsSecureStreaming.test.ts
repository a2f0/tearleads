import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
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
  useVfsSecureFacade: vi.fn(() => null),
  useVfsOrchestratorInstance: vi.fn(() => null)
}));

import { fileTypeFromBuffer } from 'file-type';
import {
  useVfsOrchestratorInstance,
  useVfsSecureFacade
} from '@/contexts/VfsOrchestratorContext';
import { getDatabase } from '@/db';
import { logEvent } from '@/db/analytics';
import { getKeyManager } from '@/db/crypto';
import { isLoggedIn } from '@/lib/authStorage';
import { getFeatureFlagValue } from '@/lib/featureFlags';
import {
  computeContentHashStreaming,
  createStreamFromFile,
  readFileAsUint8Array
} from '@/lib/fileUtils';
import { generateThumbnail, isThumbnailSupported } from '@/lib/thumbnail';
import { getFileStorage, isFileStorageInitialized } from '@/storage/opfs';
import { generateSessionKey, wrapSessionKey } from './useVfsKeys';

describe('useFileUpload secure streaming', () => {
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
    vi.mocked(mockStorage.measureStoreBlob).mockResolvedValue('storage/path');
    vi.mocked(isThumbnailSupported).mockReturnValue(false);
    vi.mocked(generateThumbnail).mockResolvedValue(new Uint8Array([1, 2, 3]));
    vi.mocked(logEvent).mockResolvedValue(undefined);
    vi.mocked(isLoggedIn).mockReturnValue(true);
    vi.mocked(getFeatureFlagValue).mockImplementation((flag: string) => {
      return flag === 'vfsSecureUpload';
    });
    vi.mocked(generateSessionKey).mockReturnValue(new Uint8Array(32));
    vi.mocked(wrapSessionKey).mockResolvedValue('wrapped-key');

    vi.stubGlobal('crypto', {
      randomUUID: () => 'test-uuid-1234'
    });

    vi.mocked(fileTypeFromBuffer).mockResolvedValue({
      ext: 'png',
      mime: 'image/png'
    });
  });

  it('uses separate file streams for hash and secure upload', async () => {
    const hashStream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array([1]));
        controller.close();
      }
    });
    const secureStream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array([2]));
        controller.close();
      }
    });
    vi.mocked(createStreamFromFile)
      .mockReturnValueOnce(hashStream)
      .mockReturnValueOnce(secureStream);

    const mockSecureFacade = {
      stageAttachEncryptedBlobAndPersist: vi.fn().mockResolvedValue({
        stagingId: 'test-staging-id',
        manifest: {}
      })
    };
    vi.mocked(useVfsSecureFacade).mockReturnValue(
      mockSecureFacade as unknown as ReturnType<typeof useVfsSecureFacade>
    );
    vi.mocked(useVfsOrchestratorInstance).mockReturnValue(
      {
        flushAll: vi.fn().mockResolvedValue({ success: true })
      } as unknown as ReturnType<typeof useVfsOrchestratorInstance>
    );

    const { result } = renderHook(() => useFileUpload());
    const file = new File(['test'], 'test.png', { type: 'image/png' });
    await result.current.uploadFile(file);

    expect(computeContentHashStreaming).toHaveBeenCalledWith(hashStream);
    expect(
      mockSecureFacade.stageAttachEncryptedBlobAndPersist
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        stream: secureStream
      })
    );
  });

  it('uses blob storage plus secure streaming for large secure uploads', async () => {
    const mockSecureFacade = {
      stageAttachEncryptedBlobAndPersist: vi.fn().mockResolvedValue({
        stagingId: 'test-staging-id',
        manifest: {}
      })
    };
    vi.mocked(useVfsSecureFacade).mockReturnValue(
      mockSecureFacade as unknown as ReturnType<typeof useVfsSecureFacade>
    );
    vi.mocked(useVfsOrchestratorInstance).mockReturnValue(
      {
        flushAll: vi.fn().mockResolvedValue({ success: true })
      } as unknown as ReturnType<typeof useVfsOrchestratorInstance>
    );

    vi.mocked(fileTypeFromBuffer).mockResolvedValue({
      ext: 'bin',
      mime: 'application/octet-stream'
    });
    const largeFile = new File(
      [new Uint8Array(17 * 1024 * 1024)],
      'large-secure.bin',
      { type: 'application/octet-stream' }
    );

    const { result } = renderHook(() => useFileUpload());
    await result.current.uploadFile(largeFile);

    expect(mockStorage.measureStoreBlob).toHaveBeenCalledWith(
      'test-uuid-1234',
      largeFile,
      expect.any(Function)
    );
    expect(mockStorage.measureStore).not.toHaveBeenCalled();
    expect(readFileAsUint8Array).not.toHaveBeenCalled();
    expect(createStreamFromFile).toHaveBeenCalledTimes(2);
    expect(
      mockSecureFacade.stageAttachEncryptedBlobAndPersist
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        itemId: 'test-uuid-1234',
        contentType: 'application/octet-stream'
      })
    );
  });
});
