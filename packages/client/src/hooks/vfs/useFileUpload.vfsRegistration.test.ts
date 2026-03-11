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
    fileTypeFromBuffer.mockResolvedValue({
      ext: 'png',
      mime: 'image/png'
    });
  });

  it('still registers locally when user is not logged in', async () => {
    isLoggedIn.mockReturnValue(false);

    const { result } = renderHook(() => useFileUpload());
    const file = new File(['test'], 'test.png', { type: 'image/png' });

    await result.current.uploadFile(file);

    expect(mockDb.insert).toHaveBeenCalled();
  });

  it('wraps session keys when user is logged in', async () => {
    isLoggedIn.mockReturnValue(true);

    const { result } = renderHook(() => useFileUpload());
    const file = new File(['test'], 'test.png', { type: 'image/png' });

    await result.current.uploadFile(file);

    expect(generateSessionKey).toHaveBeenCalled();
    expect(wrapSessionKey).toHaveBeenCalled();
  });

  it('still saves locally when session key wrapping fails', async () => {
    const consoleSpy = mockConsoleWarn();
    isLoggedIn.mockReturnValue(true);
    wrapSessionKey.mockRejectedValue(new Error('VFS error'));

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
    isLoggedIn.mockReturnValue(true);
    getFeatureFlagValue.mockImplementation((flag: string) => {
      return flag === 'vfsSecureUpload';
    });

    const mockSecureFacade = {
      stageAttachEncryptedBlobAndPersist: vi.fn().mockResolvedValue({
        stagingId: 'test-staging-id',
        manifest: {}
      })
    };
    useVfsSecureFacade.mockReturnValue(
      mockSecureFacade as unknown as ReturnType<typeof useVfsSecureFacade>
    );

    const mockOrchestrator = {
      flushAll: vi.fn().mockResolvedValue({ success: true })
    };
    useVfsOrchestratorInstance.mockReturnValue(
      mockOrchestrator as unknown as ReturnType<
        typeof useVfsOrchestratorInstance
      >
    );

    const { result } = renderHook(() => useFileUpload());
    const file = new File(['test'], 'test.png', { type: 'image/png' });

    await result.current.uploadFile(file);

    expect(api.vfs.register).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'test-uuid-1234',
        objectType: 'file',
        encryptedSessionKey: 'wrapped-key'
      })
    );
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
    isLoggedIn.mockReturnValue(true);
    getFeatureFlagValue.mockImplementation((flag: string) => {
      return flag === 'vfsSecureUpload';
    });

    const mockSecureFacade = {
      stageAttachEncryptedBlobAndPersist: vi
        .fn()
        .mockRejectedValue(new Error('Network error'))
    };
    useVfsSecureFacade.mockReturnValue(
      mockSecureFacade as unknown as ReturnType<typeof useVfsSecureFacade>
    );

    const mockOrchestrator = {
      flushAll: vi.fn().mockResolvedValue({ success: true })
    };
    useVfsOrchestratorInstance.mockReturnValue(
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

  it('fails closed when secure upload registration fails', async () => {
    isLoggedIn.mockReturnValue(true);
    getFeatureFlagValue.mockImplementation((flag: string) => {
      return flag === 'vfsSecureUpload';
    });
    api.vfs.register.mockRejectedValue(new Error('register failed'));

    const mockSecureFacade = {
      stageAttachEncryptedBlobAndPersist: vi.fn()
    };
    useVfsSecureFacade.mockReturnValue(
      mockSecureFacade as unknown as ReturnType<typeof useVfsSecureFacade>
    );

    const mockOrchestrator = {
      flushAll: vi.fn()
    };
    useVfsOrchestratorInstance.mockReturnValue(
      mockOrchestrator as unknown as ReturnType<
        typeof useVfsOrchestratorInstance
      >
    );

    const { result } = renderHook(() => useFileUpload());
    const file = new File(['test'], 'test.png', { type: 'image/png' });

    await expect(result.current.uploadFile(file)).rejects.toThrow(
      'Secure upload failed (register)'
    );
    expect(
      mockSecureFacade.stageAttachEncryptedBlobAndPersist
    ).not.toHaveBeenCalled();
    expect(mockOrchestrator.flushAll).not.toHaveBeenCalled();
    expect(logEvent).toHaveBeenCalledWith(
      expect.anything(),
      'vfs_secure_upload',
      expect.any(Number),
      false,
      expect.objectContaining({
        failStage: 'register'
      })
    );
  });

  it('fails closed when secure upload flushAll fails', async () => {
    isLoggedIn.mockReturnValue(true);
    getFeatureFlagValue.mockImplementation((flag: string) => {
      return flag === 'vfsSecureUpload';
    });

    const mockSecureFacade = {
      stageAttachEncryptedBlobAndPersist: vi.fn().mockResolvedValue({
        stagingId: 'test-staging-id',
        manifest: {}
      })
    };
    useVfsSecureFacade.mockReturnValue(
      mockSecureFacade as unknown as ReturnType<typeof useVfsSecureFacade>
    );

    const mockOrchestrator = {
      flushAll: vi.fn().mockRejectedValue(new Error('Network flush failed'))
    };
    useVfsOrchestratorInstance.mockReturnValue(
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
    isLoggedIn.mockReturnValue(true);
    getFeatureFlagValue.mockImplementation((flag: string) => {
      return flag === 'vfsSecureUpload';
    });
    useVfsSecureFacade.mockReturnValue(null);
    useVfsOrchestratorInstance.mockReturnValue(null);

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

  it('does not register on server when secure upload is disabled', async () => {
    isLoggedIn.mockReturnValue(true);
    getFeatureFlagValue.mockImplementation((flag: string) => {
      return flag === 'vfsServerRegistration';
    });
    useVfsSecureFacade.mockReturnValue(null);

    const { result } = renderHook(() => useFileUpload());
    const file = new File(['test'], 'test.png', { type: 'image/png' });

    await result.current.uploadFile(file);

    expect(api.vfs.register).not.toHaveBeenCalled();
  });
});
