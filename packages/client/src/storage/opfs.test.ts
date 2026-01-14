/**
 * Unit tests for OPFS storage module.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DatabaseInsert } from '@/db/analytics';
import { mockConsoleWarn } from '@/test/console-mocks';

// Use vi.hoisted for mock functions to avoid hoisting issues
const { mockImportKey, mockEncrypt, mockDecrypt } = vi.hoisted(() => ({
  mockImportKey: vi.fn(),
  mockEncrypt: vi.fn(),
  mockDecrypt: vi.fn()
}));

vi.mock('@rapid/shared', async (importOriginal) => {
  const original = await importOriginal<typeof import('@rapid/shared')>();
  return {
    ...original,
    importKey: mockImportKey,
    encrypt: mockEncrypt,
    decrypt: mockDecrypt
  };
});

// Import after mocks
import {
  clearFileStorageForInstance,
  clearFileStorageInstance,
  createRetrieveLogger,
  createStoreLogger,
  deleteFileStorageForInstance,
  getCurrentStorageInstanceId,
  getFileStorage,
  getFileStorageForInstance,
  initializeFileStorage,
  isFileStorageInitialized,
  type RetrieveMetrics,
  type StoreMetrics,
  setCurrentStorageInstanceId
} from './opfs';

type MockWritableStream = {
  write: ReturnType<typeof vi.fn>;
  close: ReturnType<typeof vi.fn>;
};

type MockFileHandle = {
  kind: 'file';
  name: string;
  _content: Uint8Array;
  getFile: ReturnType<typeof vi.fn>;
  createWritable: ReturnType<typeof vi.fn>;
  isSameEntry: ReturnType<typeof vi.fn>;
  queryPermission: ReturnType<typeof vi.fn>;
  requestPermission: ReturnType<typeof vi.fn>;
};

type MockDirectoryHandle = {
  kind: 'directory';
  name: string;
  getFileHandle: ReturnType<typeof vi.fn>;
  getDirectoryHandle: ReturnType<typeof vi.fn>;
  removeEntry: ReturnType<typeof vi.fn>;
  resolve: ReturnType<typeof vi.fn>;
  keys: ReturnType<typeof vi.fn>;
  values: ReturnType<typeof vi.fn>;
  entries: ReturnType<typeof vi.fn>;
  isSameEntry: ReturnType<typeof vi.fn>;
  queryPermission: ReturnType<typeof vi.fn>;
  requestPermission: ReturnType<typeof vi.fn>;
};

type MockHandle = MockFileHandle | MockDirectoryHandle;

function setStorageFilesDirectoryNull(storage: object) {
  Object.defineProperty(storage, 'filesDirectory', {
    value: null,
    writable: true
  });
}

// Mock FileSystem handles
const createMockFileHandle = (content: Uint8Array): MockFileHandle => {
  const fileBuffer = content.buffer;
  if (!(fileBuffer instanceof ArrayBuffer)) {
    throw new Error('Expected ArrayBuffer for mock file data.');
  }
  const file = {
    arrayBuffer: async () => fileBuffer,
    size: content.byteLength
  };
  const write = vi.fn();
  const close = vi.fn();
  const createWritable = vi.fn(
    async (): Promise<MockWritableStream> => ({
      write,
      close
    })
  );

  return {
    kind: 'file',
    name: 'test.enc',
    _content: content,
    getFile: vi.fn(async () => file),
    createWritable,
    isSameEntry: vi.fn(),
    queryPermission: vi.fn(),
    requestPermission: vi.fn()
  };
};

const createMockDirectoryHandle = (
  files: Map<string, MockHandle> = new Map()
): MockDirectoryHandle => {
  const getFileHandle = vi.fn(
    async (name: string, options?: { create?: boolean }) => {
      const existing = files.get(name);
      if (existing && existing.kind === 'file') {
        return existing;
      }
      if (options?.create) {
        const newHandle = createMockFileHandle(new Uint8Array());
        files.set(name, newHandle);
        return newHandle;
      }
      throw new DOMException('File not found', 'NotFoundError');
    }
  );
  const getDirectoryHandle = vi.fn(
    async (name: string, options?: { create?: boolean }) => {
      const existing = files.get(name);
      if (existing && existing.kind === 'directory') {
        return existing;
      }
      if (options?.create) {
        const newDir = createMockDirectoryHandle(new Map());
        files.set(name, newDir);
        return newDir;
      }
      throw new DOMException('Directory not found', 'NotFoundError');
    }
  );
  const removeEntry = vi.fn(async (name: string) => {
    files.delete(name);
  });

  return {
    kind: 'directory',
    name: 'test-dir',
    getFileHandle,
    getDirectoryHandle,
    removeEntry,
    resolve: vi.fn(),
    keys: vi.fn(),
    values: vi.fn(),
    entries: vi.fn(async function* () {
      for (const entry of files.entries()) {
        yield entry;
      }
    }),
    isSameEntry: vi.fn(),
    queryPermission: vi.fn(),
    requestPermission: vi.fn()
  };
};

describe('opfs storage', () => {
  let mockRootDirectory: MockDirectoryHandle;
  let mockFilesDirectory: MockDirectoryHandle;
  const testInstanceId = 'test-instance';
  const testEncryptionKey = new Uint8Array(32);
  const mockCryptoKey: CryptoKey = {
    type: 'secret',
    extractable: true,
    algorithm: { name: 'AES-GCM' },
    usages: ['encrypt', 'decrypt']
  };

  beforeEach(() => {
    vi.clearAllMocks();

    // Reset module state
    clearFileStorageInstance();

    // Setup mock OPFS
    mockFilesDirectory = createMockDirectoryHandle(new Map());
    mockRootDirectory = createMockDirectoryHandle(new Map());
    mockRootDirectory.getDirectoryHandle.mockResolvedValue(mockFilesDirectory);

    // Mock navigator.storage
    Object.defineProperty(globalThis.navigator, 'storage', {
      value: {
        getDirectory: vi.fn(async () => mockRootDirectory)
      },
      writable: true,
      configurable: true
    });

    // Setup crypto mocks
    mockImportKey.mockResolvedValue(mockCryptoKey);
    mockEncrypt.mockImplementation(async (data: Uint8Array) => {
      // Simple mock: just return the data with "encrypted" marker
      const result = new Uint8Array(data.length + 1);
      result[0] = 255; // Marker
      result.set(data, 1);
      return result;
    });
    mockDecrypt.mockImplementation(async (data: Uint8Array) => {
      // Simple mock: remove the marker
      return data.slice(1);
    });
  });

  describe('initializeFileStorage', () => {
    it('creates and initializes storage instance', async () => {
      const storage = await initializeFileStorage(
        testEncryptionKey,
        testInstanceId
      );

      expect(storage).toBeDefined();
      expect(storage.instanceId).toBe(testInstanceId);
      expect(mockImportKey).toHaveBeenCalledWith(testEncryptionKey);
    });

    it('returns existing storage if already initialized', async () => {
      const storage1 = await initializeFileStorage(
        testEncryptionKey,
        testInstanceId
      );
      const storage2 = await initializeFileStorage(
        testEncryptionKey,
        testInstanceId
      );

      expect(storage1).toBe(storage2);
      expect(mockImportKey).toHaveBeenCalledTimes(1);
    });

    it('creates namespaced directory for instance', async () => {
      await initializeFileStorage(testEncryptionKey, testInstanceId);

      expect(mockRootDirectory.getDirectoryHandle).toHaveBeenCalledWith(
        `rapid-files-${testInstanceId}`,
        { create: true }
      );
    });

    it('sets current instance ID', async () => {
      await initializeFileStorage(testEncryptionKey, testInstanceId);

      expect(getCurrentStorageInstanceId()).toBe(testInstanceId);
    });
  });

  describe('getFileStorageForInstance', () => {
    it('returns storage for initialized instance', async () => {
      await initializeFileStorage(testEncryptionKey, testInstanceId);

      const storage = getFileStorageForInstance(testInstanceId);

      expect(storage.instanceId).toBe(testInstanceId);
    });

    it('throws for uninitialized instance', () => {
      expect(() => getFileStorageForInstance('unknown-instance')).toThrow(
        'File storage not initialized for instance unknown-instance'
      );
    });
  });

  describe('getFileStorage', () => {
    it('returns storage for current instance', async () => {
      await initializeFileStorage(testEncryptionKey, testInstanceId);

      const storage = getFileStorage();

      expect(storage.instanceId).toBe(testInstanceId);
    });

    it('throws when no current instance', () => {
      expect(() => getFileStorage()).toThrow(
        'No current file storage instance'
      );
    });
  });

  describe('isFileStorageInitialized', () => {
    it('returns false when no storage initialized', () => {
      expect(isFileStorageInitialized()).toBe(false);
    });

    it('returns true after initialization', async () => {
      await initializeFileStorage(testEncryptionKey, testInstanceId);

      expect(isFileStorageInitialized()).toBe(true);
    });

    it('checks specific instance when provided', async () => {
      await initializeFileStorage(testEncryptionKey, testInstanceId);

      expect(isFileStorageInitialized(testInstanceId)).toBe(true);
      expect(isFileStorageInitialized('other-instance')).toBe(false);
    });
  });

  describe('clearFileStorageForInstance', () => {
    it('removes storage for specific instance', async () => {
      await initializeFileStorage(testEncryptionKey, testInstanceId);

      clearFileStorageForInstance(testInstanceId);

      expect(isFileStorageInitialized(testInstanceId)).toBe(false);
    });

    it('clears current instance ID if matching', async () => {
      await initializeFileStorage(testEncryptionKey, testInstanceId);

      clearFileStorageForInstance(testInstanceId);

      expect(getCurrentStorageInstanceId()).toBeNull();
    });

    it('does not clear current instance ID if not matching', async () => {
      await initializeFileStorage(testEncryptionKey, testInstanceId);
      const otherInstance = 'other-instance';
      await initializeFileStorage(testEncryptionKey, otherInstance);
      setCurrentStorageInstanceId(testInstanceId);

      clearFileStorageForInstance(otherInstance);

      expect(getCurrentStorageInstanceId()).toBe(testInstanceId);
    });
  });

  describe('clearFileStorageInstance', () => {
    it('clears all storage instances', async () => {
      await initializeFileStorage(testEncryptionKey, 'instance-1');
      await initializeFileStorage(testEncryptionKey, 'instance-2');

      clearFileStorageInstance();

      expect(isFileStorageInitialized('instance-1')).toBe(false);
      expect(isFileStorageInitialized('instance-2')).toBe(false);
      expect(getCurrentStorageInstanceId()).toBeNull();
    });
  });

  describe('setCurrentStorageInstanceId', () => {
    it('sets the current instance ID', () => {
      setCurrentStorageInstanceId('new-instance');

      expect(getCurrentStorageInstanceId()).toBe('new-instance');
    });

    it('allows setting to null', () => {
      setCurrentStorageInstanceId('instance');
      setCurrentStorageInstanceId(null);

      expect(getCurrentStorageInstanceId()).toBeNull();
    });
  });

  describe('getCurrentStorageInstanceId', () => {
    it('returns null when not set', () => {
      expect(getCurrentStorageInstanceId()).toBeNull();
    });

    it('returns current instance ID when set', async () => {
      await initializeFileStorage(testEncryptionKey, testInstanceId);

      expect(getCurrentStorageInstanceId()).toBe(testInstanceId);
    });
  });

  describe('deleteFileStorageForInstance', () => {
    it('clears storage instance', async () => {
      await initializeFileStorage(testEncryptionKey, testInstanceId);

      await deleteFileStorageForInstance(testInstanceId);

      expect(isFileStorageInitialized(testInstanceId)).toBe(false);
    });

    it('removes directory from OPFS', async () => {
      await initializeFileStorage(testEncryptionKey, testInstanceId);

      await deleteFileStorageForInstance(testInstanceId);

      expect(mockRootDirectory.removeEntry).toHaveBeenCalledWith(
        `rapid-files-${testInstanceId}`,
        { recursive: true }
      );
    });

    it('handles missing directory gracefully', async () => {
      mockRootDirectory.removeEntry.mockRejectedValue(new Error('Not found'));

      // Should not throw
      await expect(
        deleteFileStorageForInstance('nonexistent')
      ).resolves.toBeUndefined();
    });

    it('handles OPFS not supported gracefully', async () => {
      // Remove OPFS support by making getDirectory undefined
      Object.defineProperty(globalThis.navigator, 'storage', {
        value: {
          getDirectory: undefined
        },
        writable: true,
        configurable: true
      });

      // Should not throw
      await expect(
        deleteFileStorageForInstance(testInstanceId)
      ).resolves.toBeUndefined();
    });
  });

  describe('OPFSStorage class methods', () => {
    describe('store', () => {
      it('encrypts and stores data', async () => {
        const storage = await initializeFileStorage(
          testEncryptionKey,
          testInstanceId
        );
        const data = new Uint8Array([1, 2, 3, 4]);

        const path = await storage.store('file-id', data);

        expect(path).toBe('file-id.enc');
        expect(mockEncrypt).toHaveBeenCalledWith(data, mockCryptoKey);
      });

      it('throws if storage not initialized', async () => {
        const storage = await initializeFileStorage(
          testEncryptionKey,
          testInstanceId
        );
        // Manually break the storage
        setStorageFilesDirectoryNull(storage);

        await expect(storage.store('id', new Uint8Array())).rejects.toThrow(
          'Storage not initialized'
        );
      });
    });

    describe('measureStore', () => {
      it('encrypts and stores data with timing', async () => {
        const storage = await initializeFileStorage(
          testEncryptionKey,
          testInstanceId
        );
        const data = new Uint8Array([1, 2, 3, 4]);

        const path = await storage.measureStore('file-id', data);

        expect(path).toBe('file-id.enc');
        expect(mockEncrypt).toHaveBeenCalledWith(data, mockCryptoKey);
      });

      it('calls onMetrics callback with correct data on success', async () => {
        const storage = await initializeFileStorage(
          testEncryptionKey,
          testInstanceId
        );
        const data = new Uint8Array([1, 2, 3, 4]);

        const onMetrics = vi.fn();
        await storage.measureStore('file-id', data, onMetrics);

        // Wait for fire-and-forget callback
        await new Promise((r) => setTimeout(r, 0));

        expect(onMetrics).toHaveBeenCalledWith(
          expect.objectContaining({
            storagePath: 'file-id.enc',
            success: true,
            fileSize: 4 // input data size
          })
        );
        const callArgs = onMetrics.mock.calls[0];
        expect(callArgs).toBeDefined();
        expect(callArgs?.[0].durationMs).toBeGreaterThanOrEqual(0);
      });

      it('calls onMetrics callback with success=false on error', async () => {
        const storage = await initializeFileStorage(
          testEncryptionKey,
          testInstanceId
        );
        const data = new Uint8Array([1, 2, 3, 4]);

        mockEncrypt.mockRejectedValueOnce(new Error('Encryption failed'));

        const onMetrics = vi.fn();
        await expect(
          storage.measureStore('file-id', data, onMetrics)
        ).rejects.toThrow('Encryption failed');

        // Wait for fire-and-forget callback
        await new Promise((r) => setTimeout(r, 0));

        expect(onMetrics).toHaveBeenCalledWith(
          expect.objectContaining({
            storagePath: '',
            success: false,
            fileSize: 4
          })
        );
      });

      it('works without onMetrics callback', async () => {
        const storage = await initializeFileStorage(
          testEncryptionKey,
          testInstanceId
        );
        const data = new Uint8Array([1, 2, 3, 4]);

        const path = await storage.measureStore('file-id', data);

        expect(path).toBe('file-id.enc');
      });

      it('silently ignores callback errors', async () => {
        const consoleSpy = mockConsoleWarn();
        const storage = await initializeFileStorage(
          testEncryptionKey,
          testInstanceId
        );
        const data = new Uint8Array([1, 2, 3, 4]);

        const onMetrics = vi
          .fn()
          .mockRejectedValue(new Error('Callback error'));
        const path = await storage.measureStore('file-id', data, onMetrics);

        // Wait for fire-and-forget callback
        await new Promise((r) => setTimeout(r, 0));

        // Should still return the path
        expect(path).toBe('file-id.enc');
        expect(consoleSpy).toHaveBeenCalledWith(
          'onMetrics callback failed in measureStore:',
          expect.any(Error)
        );
        consoleSpy.mockRestore();
      });
    });

    describe('retrieve', () => {
      it('retrieves and decrypts data', async () => {
        const storage = await initializeFileStorage(
          testEncryptionKey,
          testInstanceId
        );

        // Setup a file
        const encryptedData = new Uint8Array([255, 1, 2, 3]);
        const mockFileHandle = createMockFileHandle(encryptedData);
        mockFilesDirectory.getFileHandle.mockResolvedValue(mockFileHandle);

        const result = await storage.retrieve('test.enc');

        expect(mockDecrypt).toHaveBeenCalledWith(
          expect.any(Uint8Array),
          mockCryptoKey
        );
        expect(result).toBeInstanceOf(Uint8Array);
      });

      it('throws if storage not initialized', async () => {
        const storage = await initializeFileStorage(
          testEncryptionKey,
          testInstanceId
        );
        setStorageFilesDirectoryNull(storage);

        await expect(storage.retrieve('test.enc')).rejects.toThrow(
          'Storage not initialized'
        );
      });
    });

    describe('measureRetrieve', () => {
      it('retrieves and decrypts data with timing', async () => {
        const storage = await initializeFileStorage(
          testEncryptionKey,
          testInstanceId
        );

        const encryptedData = new Uint8Array([255, 1, 2, 3]);
        const mockFileHandle = createMockFileHandle(encryptedData);
        mockFilesDirectory.getFileHandle.mockResolvedValue(mockFileHandle);

        const result = await storage.measureRetrieve('test.enc');

        expect(mockDecrypt).toHaveBeenCalledWith(
          expect.any(Uint8Array),
          mockCryptoKey
        );
        expect(result).toBeInstanceOf(Uint8Array);
      });

      it('calls onMetrics callback with correct data on success', async () => {
        const storage = await initializeFileStorage(
          testEncryptionKey,
          testInstanceId
        );

        const encryptedData = new Uint8Array([255, 1, 2, 3]);
        const mockFileHandle = createMockFileHandle(encryptedData);
        mockFilesDirectory.getFileHandle.mockResolvedValue(mockFileHandle);

        const onMetrics = vi.fn();
        await storage.measureRetrieve('test.enc', onMetrics);

        // Wait for fire-and-forget callback
        await new Promise((r) => setTimeout(r, 0));

        expect(onMetrics).toHaveBeenCalledWith(
          expect.objectContaining({
            storagePath: 'test.enc',
            success: true,
            fileSize: 3 // decrypted data size (255 marker removed = 3 bytes)
          })
        );
        const callArgs = onMetrics.mock.calls[0];
        expect(callArgs).toBeDefined();
        expect(callArgs?.[0].durationMs).toBeGreaterThanOrEqual(0);
      });

      it('calls onMetrics callback with success=false on error', async () => {
        const storage = await initializeFileStorage(
          testEncryptionKey,
          testInstanceId
        );

        mockFilesDirectory.getFileHandle.mockRejectedValue(
          new Error('File not found')
        );

        const onMetrics = vi.fn();
        await expect(
          storage.measureRetrieve('missing.enc', onMetrics)
        ).rejects.toThrow('File not found');

        // Wait for fire-and-forget callback
        await new Promise((r) => setTimeout(r, 0));

        expect(onMetrics).toHaveBeenCalledWith(
          expect.objectContaining({
            storagePath: 'missing.enc',
            success: false,
            fileSize: 0
          })
        );
      });

      it('works without onMetrics callback', async () => {
        const storage = await initializeFileStorage(
          testEncryptionKey,
          testInstanceId
        );

        const encryptedData = new Uint8Array([255, 1, 2, 3]);
        const mockFileHandle = createMockFileHandle(encryptedData);
        mockFilesDirectory.getFileHandle.mockResolvedValue(mockFileHandle);

        const result = await storage.measureRetrieve('test.enc');

        expect(result).toBeInstanceOf(Uint8Array);
      });

      it('silently ignores callback errors', async () => {
        const consoleSpy = mockConsoleWarn();
        const storage = await initializeFileStorage(
          testEncryptionKey,
          testInstanceId
        );

        const encryptedData = new Uint8Array([255, 1, 2, 3]);
        const mockFileHandle = createMockFileHandle(encryptedData);
        mockFilesDirectory.getFileHandle.mockResolvedValue(mockFileHandle);

        const onMetrics = vi
          .fn()
          .mockRejectedValue(new Error('Callback error'));
        const result = await storage.measureRetrieve('test.enc', onMetrics);

        // Wait for fire-and-forget callback
        await new Promise((r) => setTimeout(r, 0));

        // Should still return the data
        expect(result).toBeInstanceOf(Uint8Array);
        expect(consoleSpy).toHaveBeenCalledWith(
          'onMetrics callback failed in measureRetrieve:',
          expect.any(Error)
        );
        consoleSpy.mockRestore();
      });
    });

    describe('delete', () => {
      it('removes entry from directory', async () => {
        const storage = await initializeFileStorage(
          testEncryptionKey,
          testInstanceId
        );

        await storage.delete('test.enc');

        expect(mockFilesDirectory.removeEntry).toHaveBeenCalledWith('test.enc');
      });

      it('throws if storage not initialized', async () => {
        const storage = await initializeFileStorage(
          testEncryptionKey,
          testInstanceId
        );
        setStorageFilesDirectoryNull(storage);

        await expect(storage.delete('test.enc')).rejects.toThrow(
          'Storage not initialized'
        );
      });
    });

    describe('exists', () => {
      it('returns true if file exists', async () => {
        const storage = await initializeFileStorage(
          testEncryptionKey,
          testInstanceId
        );
        const mockFileHandle = createMockFileHandle(new Uint8Array());
        mockFilesDirectory.getFileHandle.mockResolvedValue(mockFileHandle);

        const result = await storage.exists('test.enc');

        expect(result).toBe(true);
      });

      it('returns false if file does not exist', async () => {
        const storage = await initializeFileStorage(
          testEncryptionKey,
          testInstanceId
        );
        mockFilesDirectory.getFileHandle.mockRejectedValue(
          new DOMException('Not found', 'NotFoundError')
        );

        const result = await storage.exists('nonexistent.enc');

        expect(result).toBe(false);
      });

      it('throws if storage not initialized', async () => {
        const storage = await initializeFileStorage(
          testEncryptionKey,
          testInstanceId
        );
        setStorageFilesDirectoryNull(storage);

        await expect(storage.exists('test.enc')).rejects.toThrow(
          'Storage not initialized'
        );
      });
    });

    describe('getStorageUsed', () => {
      it('calculates total size of all files', async () => {
        const storage = await initializeFileStorage(
          testEncryptionKey,
          testInstanceId
        );

        // Mock entries with files
        const file1 = createMockFileHandle(new Uint8Array(100));
        const file2 = createMockFileHandle(new Uint8Array(200));
        const entries: Array<[string, MockHandle]> = [
          ['file1.enc', file1],
          ['file2.enc', file2]
        ];

        const entriesIterator = async function* () {
          for (const entry of entries) {
            yield entry;
          }
        };

        mockFilesDirectory.entries.mockImplementation(entriesIterator);

        const result = await storage.getStorageUsed();

        expect(result).toBe(300);
      });

      it('throws if storage not initialized', async () => {
        const storage = await initializeFileStorage(
          testEncryptionKey,
          testInstanceId
        );
        setStorageFilesDirectoryNull(storage);

        await expect(storage.getStorageUsed()).rejects.toThrow(
          'Storage not initialized'
        );
      });
    });

    describe('clearAll', () => {
      it('removes all entries from directory', async () => {
        const storage = await initializeFileStorage(
          testEncryptionKey,
          testInstanceId
        );

        // Mock entries
        const file1 = createMockFileHandle(new Uint8Array());
        const file2 = createMockFileHandle(new Uint8Array());
        const entries: Array<[string, MockHandle]> = [
          ['file1.enc', file1],
          ['file2.enc', file2]
        ];

        const entriesIterator = async function* () {
          for (const entry of entries) {
            yield entry;
          }
        };

        mockFilesDirectory.entries.mockImplementation(entriesIterator);

        await storage.clearAll();

        expect(mockFilesDirectory.removeEntry).toHaveBeenCalledWith(
          'file1.enc'
        );
        expect(mockFilesDirectory.removeEntry).toHaveBeenCalledWith(
          'file2.enc'
        );
      });

      it('throws if storage not initialized', async () => {
        const storage = await initializeFileStorage(
          testEncryptionKey,
          testInstanceId
        );
        setStorageFilesDirectoryNull(storage);

        await expect(storage.clearAll()).rejects.toThrow(
          'Storage not initialized'
        );
      });
    });
  });

  describe('OPFS not supported', () => {
    it('throws when OPFS is not available', async () => {
      Object.defineProperty(globalThis.navigator, 'storage', {
        value: {},
        writable: true,
        configurable: true
      });

      await expect(
        initializeFileStorage(testEncryptionKey, testInstanceId)
      ).rejects.toThrow('OPFS is not supported in this browser');
    });
  });

  describe('createRetrieveLogger', () => {
    it('creates a logger function that logs file_decrypt events', async () => {
      const mockLogEvent = vi.fn();
      const mockDb: DatabaseInsert = {
        insert: vi.fn().mockReturnValue({
          values: vi.fn()
        })
      };

      // Reset modules and mock before re-importing
      vi.resetModules();
      vi.doMock('@/db/analytics', () => ({
        logEvent: mockLogEvent
      }));

      // Re-import to get the mocked version
      const { createRetrieveLogger: createLogger } = await import('./opfs');

      const logger = createLogger(mockDb);
      const metrics: RetrieveMetrics = {
        storagePath: 'test.enc',
        durationMs: 150,
        success: true,
        fileSize: 1024
      };

      await logger(metrics);

      expect(mockLogEvent).toHaveBeenCalledWith(
        mockDb,
        'file_decrypt',
        150,
        true
      );
    });

    it('returns an async function', () => {
      const mockDb: DatabaseInsert = {
        insert: vi.fn().mockReturnValue({
          values: vi.fn()
        })
      };
      const logger = createRetrieveLogger(mockDb);

      expect(logger).toBeInstanceOf(Function);
      // Verify it returns a promise
      const result = logger({
        storagePath: 'test.enc',
        durationMs: 100,
        success: true,
        fileSize: 500
      });
      expect(result).toBeInstanceOf(Promise);
    });
  });

  describe('createStoreLogger', () => {
    it('creates a logger function that logs file_encrypt events', async () => {
      const mockLogEvent = vi.fn();
      const mockDb: DatabaseInsert = {
        insert: vi.fn().mockReturnValue({
          values: vi.fn()
        })
      };

      // Reset modules and mock before re-importing
      vi.resetModules();
      vi.doMock('@/db/analytics', () => ({
        logEvent: mockLogEvent
      }));

      // Re-import to get the mocked version
      const { createStoreLogger: createLogger } = await import('./opfs');

      const logger = createLogger(mockDb);
      const metrics: StoreMetrics = {
        storagePath: 'test.enc',
        durationMs: 200,
        success: true,
        fileSize: 2048
      };

      await logger(metrics);

      expect(mockLogEvent).toHaveBeenCalledWith(
        mockDb,
        'file_encrypt',
        200,
        true
      );
    });

    it('returns an async function', () => {
      const mockDb: DatabaseInsert = {
        insert: vi.fn().mockReturnValue({
          values: vi.fn()
        })
      };
      const logger = createStoreLogger(mockDb);

      expect(logger).toBeInstanceOf(Function);
      // Verify it returns a promise
      const result = logger({
        storagePath: 'test.enc',
        durationMs: 100,
        success: true,
        fileSize: 500
      });
      expect(result).toBeInstanceOf(Promise);
    });
  });
});
