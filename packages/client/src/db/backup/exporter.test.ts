import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { FileStorage } from '@/storage/opfs';
import type { DatabaseAdapter } from '../adapters/types';
import { createBackup, estimateBackupSize } from './exporter';

describe('exporter', () => {
  const mockAdapter: DatabaseAdapter = {
    initialize: vi.fn(),
    execute: vi.fn(),
    executeMany: vi.fn(),
    beginTransaction: vi.fn(),
    commitTransaction: vi.fn(),
    rollbackTransaction: vi.fn(),
    close: vi.fn(),
    isOpen: vi.fn(() => true),
    rekeyDatabase: vi.fn(),
    getConnection: vi.fn(),
    exportDatabase: vi.fn(),
    importDatabase: vi.fn()
  };

  const mockFileStorage: FileStorage = {
    instanceId: 'test-instance',
    initialize: vi.fn(),
    store: vi.fn(),
    measureStore: vi.fn(),
    retrieve: vi.fn(),
    measureRetrieve: vi.fn(),
    delete: vi.fn(),
    exists: vi.fn(),
    getStorageUsed: vi.fn(),
    clearAll: vi.fn()
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('createBackup', () => {
    it('creates a backup with database only (no blobs)', async () => {
      // Mock database queries
      vi.mocked(mockAdapter.execute).mockImplementation(async (sql: string) => {
        if (sql.includes('sqlite_master') && sql.includes('table')) {
          return {
            rows: [
              {
                name: 'users',
                sql: 'CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT)'
              }
            ]
          };
        }
        if (sql.includes('sqlite_master') && sql.includes('index')) {
          return { rows: [] };
        }
        if (sql.includes('SELECT * FROM')) {
          return {
            rows: [
              { id: 1, name: 'Alice' },
              { id: 2, name: 'Bob' }
            ]
          };
        }
        return { rows: [] };
      });

      const backup = await createBackup(mockAdapter, null, {
        password: 'test-password',
        includeBlobs: false,
        instanceName: 'Test Instance'
      });

      expect(backup).toBeInstanceOf(Uint8Array);
      expect(backup.length).toBeGreaterThan(0);

      // Verify magic bytes
      const magic = new TextDecoder().decode(backup.slice(0, 8));
      expect(magic).toBe('TEARLEADSBAK');
    });

    it('creates a backup with blobs', async () => {
      // Mock database queries
      vi.mocked(mockAdapter.execute).mockImplementation(async (sql: string) => {
        if (sql.includes('sqlite_master') && sql.includes('table')) {
          return {
            rows: [
              {
                name: 'users',
                sql: 'CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT)'
              },
              {
                name: 'files',
                sql: 'CREATE TABLE files (id TEXT PRIMARY KEY, name TEXT, size INTEGER, mime_type TEXT, storage_path TEXT, deleted INTEGER)'
              }
            ]
          };
        }
        if (sql.includes('sqlite_master') && sql.includes('index')) {
          return { rows: [] };
        }
        if (sql.includes('SELECT * FROM "users"')) {
          return { rows: [{ id: 1, name: 'Alice' }] };
        }
        if (sql.includes('SELECT * FROM "files"')) {
          return { rows: [] };
        }
        if (sql.includes('FROM files WHERE deleted')) {
          return {
            rows: [
              {
                id: 'file-1',
                name: 'test.txt',
                size: 13,
                mime_type: 'text/plain',
                storage_path: 'test.txt'
              }
            ]
          };
        }
        return { rows: [] };
      });

      // Mock file storage
      vi.mocked(mockFileStorage.exists).mockResolvedValue(true);
      vi.mocked(mockFileStorage.retrieve).mockResolvedValue(
        new TextEncoder().encode('Hello, World!')
      );

      const backup = await createBackup(mockAdapter, mockFileStorage, {
        password: 'test-password',
        includeBlobs: true,
        instanceName: 'Test Instance'
      });

      expect(backup).toBeInstanceOf(Uint8Array);
      expect(backup.length).toBeGreaterThan(0);
    });

    it('calls progress callback', async () => {
      vi.mocked(mockAdapter.execute).mockImplementation(async (sql: string) => {
        if (sql.includes('sqlite_master') && sql.includes('table')) {
          return {
            rows: [
              {
                name: 'users',
                sql: 'CREATE TABLE users (id INTEGER PRIMARY KEY)'
              }
            ]
          };
        }
        if (sql.includes('sqlite_master') && sql.includes('index')) {
          return { rows: [] };
        }
        return { rows: [] };
      });

      const progressEvents: string[] = [];

      await createBackup(mockAdapter, null, {
        password: 'test-password',
        includeBlobs: false,
        onProgress: (event) => progressEvents.push(event.phase)
      });

      expect(progressEvents).toContain('preparing');
      expect(progressEvents).toContain('database');
    });
  });

  describe('estimateBackupSize', () => {
    it('estimates size for database only', async () => {
      vi.mocked(mockAdapter.execute).mockImplementation(async (sql: string) => {
        if (sql.includes('sqlite_master') && sql.includes('table')) {
          return {
            rows: [
              {
                name: 'users',
                sql: 'CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT)'
              }
            ]
          };
        }
        if (sql.includes('SELECT * FROM')) {
          return {
            rows: [
              { id: 1, name: 'Alice' },
              { id: 2, name: 'Bob' }
            ]
          };
        }
        return { rows: [] };
      });

      const estimate = await estimateBackupSize(mockAdapter, null, false);

      expect(estimate.databaseSize).toBeGreaterThan(0);
      expect(estimate.blobCount).toBe(0);
      expect(estimate.blobTotalSize).toBe(0);
      expect(estimate.estimatedTotal).toBeGreaterThan(0);
    });

    it('estimates size with blobs', async () => {
      vi.mocked(mockAdapter.execute).mockImplementation(async (sql: string) => {
        if (sql.includes('sqlite_master') && sql.includes('table')) {
          return {
            rows: [
              {
                name: 'users',
                sql: 'CREATE TABLE users (id INTEGER PRIMARY KEY)'
              }
            ]
          };
        }
        if (sql.includes('SELECT * FROM')) {
          return { rows: [] };
        }
        if (sql.includes('FROM files WHERE deleted')) {
          return {
            rows: [
              {
                id: 'file-1',
                name: 'test.txt',
                size: 1000,
                mime_type: 'text/plain',
                storage_path: 'test.txt'
              }
            ]
          };
        }
        return { rows: [] };
      });

      vi.mocked(mockFileStorage.exists).mockResolvedValue(true);

      const estimate = await estimateBackupSize(
        mockAdapter,
        mockFileStorage,
        true
      );

      expect(estimate.blobCount).toBe(1);
      expect(estimate.blobTotalSize).toBe(1000);
    });
  });
});
