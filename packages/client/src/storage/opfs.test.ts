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

vi.mock('@tearleads/shared', async (importOriginal) => {
  const original = await importOriginal<typeof import('@tearleads/shared')>();
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
  deleteFileStorageForInstance,
  getCurrentStorageInstanceId,
  getFileStorage,
  getFileStorageForInstance,
  initializeFileStorage,
  isFileStorageInitialized,
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

function _setStorageFilesDirectoryNull(storage: object) {
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
        `tearleads-files-${testInstanceId}`,
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
        `tearleads-files-${testInstanceId}`,
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
});
