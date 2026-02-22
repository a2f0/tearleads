/**
 * Unit tests for OPFS storage module.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DatabaseInsert } from '@/db/analytics';
import { mockConsoleWarn } from '@/test/consoleMocks';

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

  describe('OPFSStorage class methods', () => {
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
});
