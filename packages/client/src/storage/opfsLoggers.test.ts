/**
 * Unit tests for OPFS storage logger functions (createRetrieveLogger, createStoreLogger).
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DatabaseInsert } from '@/db/analytics';

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
  clearFileStorageInstance,
  createRetrieveLogger,
  createStoreLogger,
  initializeFileStorage,
  type RetrieveMetrics,
  type StoreMetrics
} from './opfs';

describe('OPFS storage loggers', () => {
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

    // Mock navigator.storage
    Object.defineProperty(globalThis.navigator, 'storage', {
      value: {
        getDirectory: vi.fn(async () => ({
          kind: 'directory',
          name: 'root',
          getDirectoryHandle: vi.fn(async () => ({
            kind: 'directory',
            name: 'files',
            getFileHandle: vi.fn(),
            getDirectoryHandle: vi.fn(),
            removeEntry: vi.fn(),
            resolve: vi.fn(),
            keys: vi.fn(),
            values: vi.fn(),
            entries: vi.fn(),
            isSameEntry: vi.fn(),
            queryPermission: vi.fn(),
            requestPermission: vi.fn()
          })),
          getFileHandle: vi.fn(),
          removeEntry: vi.fn(),
          resolve: vi.fn(),
          keys: vi.fn(),
          values: vi.fn(),
          entries: vi.fn(),
          isSameEntry: vi.fn(),
          queryPermission: vi.fn(),
          requestPermission: vi.fn()
        }))
      },
      writable: true,
      configurable: true
    });

    // Setup crypto mocks
    mockImportKey.mockResolvedValue(mockCryptoKey);
    mockEncrypt.mockImplementation(async (data: Uint8Array) => {
      const result = new Uint8Array(data.length + 1);
      result[0] = 255;
      result.set(data, 1);
      return result;
    });
    mockDecrypt.mockImplementation(async (data: Uint8Array) => {
      return data.slice(1);
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
        initializeFileStorage(testEncryptionKey, 'test-instance')
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
