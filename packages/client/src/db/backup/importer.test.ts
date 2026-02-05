import { describe, expect, it } from 'vitest';
import { FORMAT_VERSION } from './constants';
import { encode } from './encoder';
import { getBackupInfo, validateBackupFile } from './importer';
import type { BackupDatabase, BackupManifest } from './types';

describe('importer', () => {
  const createTestManifest = (): BackupManifest => ({
    createdAt: '2026-02-02T12:00:00.000Z',
    platform: 'web',
    appVersion: '1.0.0',
    formatVersion: FORMAT_VERSION,
    blobCount: 0,
    blobTotalSize: 0,
    instanceName: 'Test Instance'
  });

  const createTestDatabase = (): BackupDatabase => ({
    tables: [
      {
        name: 'users',
        sql: 'CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT)'
      }
    ],
    indexes: [],
    data: {
      users: [
        { id: 1, name: 'Alice' },
        { id: 2, name: 'Bob' }
      ]
    }
  });

  describe('validateBackupFile', () => {
    it('returns valid for correct password', async () => {
      const manifest = createTestManifest();
      const database = createTestDatabase();
      const password = 'test-password';

      const encoded = await encode({
        password,
        manifest,
        database,
        blobs: [],
        readBlob: async () => new Uint8Array()
      });

      const result = await validateBackupFile(encoded, password);

      expect(result.valid).toBe(true);
      if (result.valid) {
        expect(result.manifest).toBeDefined();
        expect(result.manifest.platform).toBe('web');
      }
    });

    it('returns invalid for wrong password', async () => {
      const manifest = createTestManifest();
      const database = createTestDatabase();

      const encoded = await encode({
        password: 'correct-password',
        manifest,
        database,
        blobs: [],
        readBlob: async () => new Uint8Array()
      });

      const result = await validateBackupFile(encoded, 'wrong-password');

      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.error).toBeDefined();
      }
    });

    it('returns invalid for corrupted data', async () => {
      const corrupted = new Uint8Array([1, 2, 3, 4, 5]);
      const result = await validateBackupFile(corrupted, 'any-password');

      expect(result.valid).toBe(false);
    });
  });

  describe('getBackupInfo', () => {
    it('returns manifest and suggested name for valid backup', async () => {
      const manifest = createTestManifest();
      const database = createTestDatabase();
      const password = 'test-password';

      const encoded = await encode({
        password,
        manifest,
        database,
        blobs: [],
        readBlob: async () => new Uint8Array()
      });

      const info = await getBackupInfo(encoded, password);

      expect(info).not.toBeNull();
      expect(info?.manifest).toBeDefined();
      expect(info?.suggestedName).toContain('Backup');
      expect(info?.suggestedName).toContain('Feb 2');
    });

    it('returns null for invalid password', async () => {
      const manifest = createTestManifest();
      const database = createTestDatabase();

      const encoded = await encode({
        password: 'correct-password',
        manifest,
        database,
        blobs: [],
        readBlob: async () => new Uint8Array()
      });

      const info = await getBackupInfo(encoded, 'wrong-password');

      expect(info).toBeNull();
    });

    it('generates correct suggested name format', async () => {
      // Test with a different date
      const manifest: BackupManifest = {
        createdAt: '2025-12-25T10:30:00.000Z',
        platform: 'electron',
        appVersion: '2.0.0',
        formatVersion: FORMAT_VERSION,
        blobCount: 5,
        blobTotalSize: 5000
      };
      const database = createTestDatabase();
      const password = 'test-password';

      const encoded = await encode({
        password,
        manifest,
        database,
        blobs: [],
        readBlob: async () => new Uint8Array()
      });

      const info = await getBackupInfo(encoded, password);

      expect(info?.suggestedName).toContain('Backup');
      expect(info?.suggestedName).toContain('Dec');
      expect(info?.suggestedName).toContain('25');
      expect(info?.suggestedName).toContain('2025');
    });
  });
});
