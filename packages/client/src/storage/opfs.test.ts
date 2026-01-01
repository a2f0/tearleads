/**
 * Unit tests for OPFS storage module.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

// Use vi.hoisted for mock functions to avoid hoisting issues
const { mockImportKey, mockEncrypt, mockDecrypt } = vi.hoisted(() => ({
  mockImportKey: vi.fn(),
  mockEncrypt: vi.fn(),
  mockDecrypt: vi.fn()
}));

vi.mock('@/db/crypto/web-crypto', () => ({
  importKey: mockImportKey,
  encrypt: mockEncrypt,
  decrypt: mockDecrypt
}));

// Import after mocks
import {
  clearFileStorageForInstance,
  clearFileStorageInstance,
  deleteFileStorageForInstance,
  getCurrentStorageInstanceId,
  getFileStorage,
  getFileStorageForInstance,
  initializeFileStorage,
  isFileStorageInitialized,
  setCurrentStorageInstanceId
} from './opfs';

// Mock FileSystem handles
const createMockFileHandle = (
  content: Uint8Array
): FileSystemFileHandle & { _content: Uint8Array } => {
  return {
    kind: 'file' as const,
    name: 'test.enc',
    _content: content,
    getFile: vi.fn(async () => ({
      arrayBuffer: async () => content.buffer,
      size: content.byteLength
    })),
    createWritable: vi.fn(async () => ({
      write: vi.fn(),
      close: vi.fn()
    })),
    isSameEntry: vi.fn(),
    queryPermission: vi.fn(),
    requestPermission: vi.fn()
  } as unknown as FileSystemFileHandle & { _content: Uint8Array };
};

const createMockDirectoryHandle = (
  files: Map<string, FileSystemHandle> = new Map()
): FileSystemDirectoryHandle => {
  return {
    kind: 'directory' as const,
    name: 'test-dir',
    getFileHandle: vi.fn(
      async (name: string, options?: { create?: boolean }) => {
        const existing = files.get(name);
        if (existing && existing.kind === 'file') {
          return existing as FileSystemFileHandle;
        }
        if (options?.create) {
          const newHandle = createMockFileHandle(new Uint8Array());
          files.set(name, newHandle);
          return newHandle;
        }
        throw new DOMException('File not found', 'NotFoundError');
      }
    ),
    getDirectoryHandle: vi.fn(
      async (name: string, options?: { create?: boolean }) => {
        const existing = files.get(name);
        if (existing && existing.kind === 'directory') {
          return existing as FileSystemDirectoryHandle;
        }
        if (options?.create) {
          const newDir = createMockDirectoryHandle(new Map());
          files.set(name, newDir);
          return newDir;
        }
        throw new DOMException('Directory not found', 'NotFoundError');
      }
    ),
    removeEntry: vi.fn(async (name: string) => {
      files.delete(name);
    }),
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
  } as unknown as FileSystemDirectoryHandle;
};

describe('opfs storage', () => {
  let mockRootDirectory: FileSystemDirectoryHandle;
  let mockFilesDirectory: FileSystemDirectoryHandle;
  const testInstanceId = 'test-instance';
  const testEncryptionKey = new Uint8Array(32);
  const mockCryptoKey = {} as CryptoKey;

  beforeEach(() => {
    vi.clearAllMocks();

    // Reset module state
    clearFileStorageInstance();

    // Setup mock OPFS
    mockFilesDirectory = createMockDirectoryHandle(new Map());
    mockRootDirectory = createMockDirectoryHandle(new Map());
    (
      mockRootDirectory.getDirectoryHandle as ReturnType<typeof vi.fn>
    ).mockResolvedValue(mockFilesDirectory);

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
      (
        mockRootDirectory.removeEntry as ReturnType<typeof vi.fn>
      ).mockRejectedValue(new Error('Not found'));

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
        (storage as unknown as { filesDirectory: null }).filesDirectory = null;

        await expect(storage.store('id', new Uint8Array())).rejects.toThrow(
          'Storage not initialized'
        );
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
        (
          mockFilesDirectory.getFileHandle as ReturnType<typeof vi.fn>
        ).mockResolvedValue(mockFileHandle);

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
        (storage as unknown as { filesDirectory: null }).filesDirectory = null;

        await expect(storage.retrieve('test.enc')).rejects.toThrow(
          'Storage not initialized'
        );
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
        (storage as unknown as { filesDirectory: null }).filesDirectory = null;

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
        (
          mockFilesDirectory.getFileHandle as ReturnType<typeof vi.fn>
        ).mockResolvedValue(mockFileHandle);

        const result = await storage.exists('test.enc');

        expect(result).toBe(true);
      });

      it('returns false if file does not exist', async () => {
        const storage = await initializeFileStorage(
          testEncryptionKey,
          testInstanceId
        );
        (
          mockFilesDirectory.getFileHandle as ReturnType<typeof vi.fn>
        ).mockRejectedValue(new DOMException('Not found', 'NotFoundError'));

        const result = await storage.exists('nonexistent.enc');

        expect(result).toBe(false);
      });

      it('throws if storage not initialized', async () => {
        const storage = await initializeFileStorage(
          testEncryptionKey,
          testInstanceId
        );
        (storage as unknown as { filesDirectory: null }).filesDirectory = null;

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
        const entries = [
          ['file1.enc', file1],
          ['file2.enc', file2]
        ] as [string, FileSystemHandle][];

        const entriesIterator = async function* () {
          for (const entry of entries) {
            yield entry;
          }
        };

        (
          mockFilesDirectory as unknown as {
            entries: () => AsyncIterableIterator<[string, FileSystemHandle]>;
          }
        ).entries = entriesIterator;

        const result = await storage.getStorageUsed();

        expect(result).toBe(300);
      });

      it('throws if storage not initialized', async () => {
        const storage = await initializeFileStorage(
          testEncryptionKey,
          testInstanceId
        );
        (storage as unknown as { filesDirectory: null }).filesDirectory = null;

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
        const entries = [
          ['file1.enc', file1],
          ['file2.enc', file2]
        ] as [string, FileSystemHandle][];

        const entriesIterator = async function* () {
          for (const entry of entries) {
            yield entry;
          }
        };

        (
          mockFilesDirectory as unknown as {
            entries: () => AsyncIterableIterator<[string, FileSystemHandle]>;
          }
        ).entries = entriesIterator;

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
        (storage as unknown as { filesDirectory: null }).filesDirectory = null;

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
});
