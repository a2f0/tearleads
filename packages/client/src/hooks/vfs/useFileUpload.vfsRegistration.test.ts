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

vi.mock('@/lib/api', () => ({
  api: {
    vfs: {
      register: vi.fn()
    }
  }
}));

import { fileTypeFromBuffer } from 'file-type';
import {
  useVfsOrchestratorInstance,
  useVfsSecureFacade
} from '@/contexts/VfsOrchestratorContext';
import { getDatabase } from '@/db';
import { logEvent } from '@/db/analytics';
import { getKeyManager } from '@/db/crypto';
import { api } from '@/lib/api';
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

describe('useFileUpload VFS registration', () => {
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

  it('uses secure facade when vfsSecureUpload feature flag is enabled', async () => {
    vi.mocked(isLoggedIn).mockReturnValue(true);
    vi.mocked(getFeatureFlagValue).mockImplementation((flag: string) => {
      return flag === 'vfsSecureUpload';
    });

    const mockSecureFacade = {
      stageAttachEncryptedBlobAndPersist: vi.fn().mockResolvedValue({
        stagingId: 'test-staging-id',
        manifest: {}
      })
    };
    vi.mocked(useVfsSecureFacade).mockReturnValue(
      mockSecureFacade as unknown as ReturnType<typeof useVfsSecureFacade>
    );

    const mockOrchestrator = {
      flushAll: vi.fn().mockResolvedValue({ success: true })
    };
    vi.mocked(useVfsOrchestratorInstance).mockReturnValue(
      mockOrchestrator as unknown as ReturnType<
        typeof useVfsOrchestratorInstance
      >
    );

    const { result } = renderHook(() => useFileUpload());
    const file = new File(['test'], 'test.png', { type: 'image/png' });

    await result.current.uploadFile(file);

    expect(
      mockSecureFacade.stageAttachEncryptedBlobAndPersist
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        itemId: 'test-uuid-1234',
        contentType: 'image/png'
      })
    );
    expect(createStreamFromFile).toHaveBeenCalledTimes(2);
    expect(mockOrchestrator.flushAll).toHaveBeenCalled();
    expect(logEvent).toHaveBeenCalledWith(
      expect.anything(),
      'vfs_secure_upload',
      expect.any(Number),
      true,
      expect.objectContaining({
        fileSize: file.size,
        mimeType: 'image/png'
      })
    );
  });

  it('fails closed when secure facade upload fails', async () => {
    vi.mocked(isLoggedIn).mockReturnValue(true);
    vi.mocked(getFeatureFlagValue).mockImplementation((flag: string) => {
      return flag === 'vfsSecureUpload';
    });

    const mockSecureFacade = {
      stageAttachEncryptedBlobAndPersist: vi
        .fn()
        .mockRejectedValue(new Error('Network error'))
    };
    vi.mocked(useVfsSecureFacade).mockReturnValue(
      mockSecureFacade as unknown as ReturnType<typeof useVfsSecureFacade>
    );

    const mockOrchestrator = {
      flushAll: vi.fn().mockResolvedValue({ success: true })
    };
    vi.mocked(useVfsOrchestratorInstance).mockReturnValue(
      mockOrchestrator as unknown as ReturnType<
        typeof useVfsOrchestratorInstance
      >
    );

    const { result } = renderHook(() => useFileUpload());
    const file = new File(['test'], 'test.png', { type: 'image/png' });

    await expect(result.current.uploadFile(file)).rejects.toThrow(
      'Secure upload failed (stage_attach)'
    );
    expect(logEvent).toHaveBeenCalledWith(
      expect.anything(),
      'vfs_secure_upload',
      expect.any(Number),
      false,
      expect.objectContaining({
        failStage: 'stage_attach'
      })
    );
  });

  it('fails closed when secure upload flushAll fails', async () => {
    vi.mocked(isLoggedIn).mockReturnValue(true);
    vi.mocked(getFeatureFlagValue).mockImplementation((flag: string) => {
      return flag === 'vfsSecureUpload';
    });

    const mockSecureFacade = {
      stageAttachEncryptedBlobAndPersist: vi.fn().mockResolvedValue({
        stagingId: 'test-staging-id',
        manifest: {}
      })
    };
    vi.mocked(useVfsSecureFacade).mockReturnValue(
      mockSecureFacade as unknown as ReturnType<typeof useVfsSecureFacade>
    );

    const mockOrchestrator = {
      flushAll: vi.fn().mockRejectedValue(new Error('Network flush failed'))
    };
    vi.mocked(useVfsOrchestratorInstance).mockReturnValue(
      mockOrchestrator as unknown as ReturnType<
        typeof useVfsOrchestratorInstance
      >
    );

    const { result } = renderHook(() => useFileUpload());
    const file = new File(['test'], 'test.png', { type: 'image/png' });

    await expect(result.current.uploadFile(file)).rejects.toThrow(
      'Secure upload failed (flush)'
    );
    expect(logEvent).toHaveBeenCalledWith(
      expect.anything(),
      'vfs_secure_upload',
      expect.any(Number),
      false,
      expect.objectContaining({
        failStage: 'flush'
      })
    );
  });

  it('fails closed when secure upload is enabled but facade is unavailable', async () => {
    vi.mocked(isLoggedIn).mockReturnValue(true);
    vi.mocked(getFeatureFlagValue).mockImplementation((flag: string) => {
      return flag === 'vfsSecureUpload';
    });
    vi.mocked(useVfsSecureFacade).mockReturnValue(null);
    vi.mocked(useVfsOrchestratorInstance).mockReturnValue(null);

    const { result } = renderHook(() => useFileUpload());
    const file = new File(['test'], 'test.png', { type: 'image/png' });

    await expect(result.current.uploadFile(file)).rejects.toThrow(
      'Secure upload is enabled but VFS secure orchestrator is not ready'
    );
    expect(logEvent).toHaveBeenCalledWith(
      expect.anything(),
      'vfs_secure_upload',
      expect.any(Number),
      false,
      expect.objectContaining({
        failStage: 'orchestrator_unavailable'
      })
    );
  });

  it('uses legacy registration when vfsServerRegistration is enabled but not vfsSecureUpload', async () => {
    vi.mocked(isLoggedIn).mockReturnValue(true);
    vi.mocked(getFeatureFlagValue).mockImplementation((flag: string) => {
      return flag === 'vfsServerRegistration';
    });
    vi.mocked(useVfsSecureFacade).mockReturnValue(null);

    const { result } = renderHook(() => useFileUpload());
    const file = new File(['test'], 'test.png', { type: 'image/png' });

    await result.current.uploadFile(file);

    expect(api.vfs.register).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'test-uuid-1234',
        objectType: 'file'
      })
    );
  });

  it('handles legacy registration failure gracefully', async () => {
    // Mock console.warn before execution
    const consoleSpy = mockConsoleWarn();

    vi.mocked(isLoggedIn).mockReturnValue(true);
    vi.mocked(getFeatureFlagValue).mockImplementation((flag: string) => {
      return flag === 'vfsServerRegistration';
    });
    vi.mocked(useVfsSecureFacade).mockReturnValue(null);
    vi.mocked(api.vfs.register).mockRejectedValue(new Error('Server error'));

    const { result } = renderHook(() => useFileUpload());
    const file = new File(['test'], 'test.png', { type: 'image/png' });

    const uploadResult = await result.current.uploadFile(file);

    // Verify the file was still saved (graceful degradation)
    expect(uploadResult.id).toBe('test-uuid-1234');
    expect(mockDb.insert).toHaveBeenCalled();

    // Clean up
    consoleSpy.mockRestore();
  });
});
