import type { DatabaseAdapter } from '@tearleads/db/adapter';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MAGIC_BYTES, MAGIC_SIZE } from '../format/index';
import type { BackupFileStorage } from './exporter';
import { createBackup, estimateBackupSize } from './exporter';

describe('exporter', () => {
  const executeMock = vi.fn();
  const existsMock = vi.fn();
  const retrieveMock = vi.fn();

  const mockAdapter: DatabaseAdapter = {
    initialize: vi.fn(),
    execute: executeMock,
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

  const mockFileStorage: BackupFileStorage = {
    exists: existsMock,
    retrieve: retrieveMock
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('createBackup', () => {
    it('creates a backup with database only (no blobs)', async () => {
      // Mock database queries
      executeMock.mockImplementation(async (sql: string) => {
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
      expect(Array.from(backup.slice(0, MAGIC_SIZE))).toEqual(
        Array.from(MAGIC_BYTES)
      );
    });

    it('creates a backup with blobs', async () => {
      // Mock database queries
      executeMock.mockImplementation(async (sql: string) => {
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
      existsMock.mockResolvedValue(true);
      retrieveMock.mockResolvedValue(
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
      executeMock.mockImplementation(async (sql: string) => {
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
      executeMock.mockImplementation(async (sql: string) => {
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
      executeMock.mockImplementation(async (sql: string) => {
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

      existsMock.mockResolvedValue(true);

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
