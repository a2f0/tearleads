/**
 * Unit tests for OPFSStorage class measure methods (measureStore, measureRetrieve).
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
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
import { clearFileStorageInstance, initializeFileStorage } from './opfs';

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

describe('OPFSStorage measure methods', () => {
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

      const onMetrics = vi.fn().mockRejectedValue(new Error('Callback error'));
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

      const onMetrics = vi.fn().mockRejectedValue(new Error('Callback error'));
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
});
