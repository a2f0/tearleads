import { describe, expect, it } from 'vitest';

import {
  FORMAT_VERSION,
  HEADER_SIZE,
  MAGIC_BYTES,
  MAGIC_SIZE,
  MAX_BLOB_CHUNK_SIZE
} from './constants';
import {
  BackupDecodeError,
  decode,
  InvalidPasswordError,
  readHeader,
  validateBackup
} from './decoder';
import { encode, estimateBackupSize } from './encoder';
import type { BackupDatabase, BackupManifest, BlobEntry } from './types';

describe('decoder', () => {
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
    indexes: [
      {
        name: 'idx_name',
        tableName: 'users',
        sql: 'CREATE INDEX idx_name ON users(name)'
      }
    ],
    data: {
      users: [
        { id: 1, name: 'Alice' },
        { id: 2, name: 'Bob' }
      ]
    }
  });

  describe('readHeader', () => {
    it('reads header from valid backup', async () => {
      const manifest = createTestManifest();
      const database = createTestDatabase();

      const encoded = await encode({
        password: 'test-password',
        manifest,
        database,
        blobs: [],
        readBlob: async () => new Uint8Array()
      });

      const header = readHeader(encoded);

      expect(header.version).toBe(1);
      expect(header.salt.length).toBe(16);
    });

    it('throws on file too small', () => {
      const tooSmall = new Uint8Array(10);

      expect(() => readHeader(tooSmall)).toThrow(BackupDecodeError);
    });

    it('throws on invalid magic bytes', () => {
      const invalid = new Uint8Array(HEADER_SIZE);
      invalid.fill(0);

      expect(() => readHeader(invalid)).toThrow('wrong magic bytes');
    });
  });

  describe('decode', () => {
    it('decodes an encoded backup correctly', async () => {
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

      const decoded = await decode({ data: encoded, password });

      expect(decoded.manifest).toEqual(manifest);
      expect(decoded.database).toEqual(database);
      expect(decoded.blobs).toHaveLength(0);
    });

    it('decodes blobs correctly', async () => {
      const manifest = {
        ...createTestManifest(),
        blobCount: 1,
        blobTotalSize: 100
      };
      const database = createTestDatabase();
      const blobs: BlobEntry[] = [
        { path: 'test.txt', mimeType: 'text/plain', size: 13 }
      ];
      const blobData = new TextEncoder().encode('Hello, World!');
      const password = 'test-password';

      const encoded = await encode({
        password,
        manifest,
        database,
        blobs,
        readBlob: async () => blobData
      });

      const decoded = await decode({ data: encoded, password });

      expect(decoded.blobs).toHaveLength(1);
      const blob = decoded.blobs[0];
      expect(blob).toBeDefined();
      expect(blob?.header.path).toBe('test.txt');
      expect(blob?.header.mimeType).toBe('text/plain');
      expect(Array.from(blob?.data ?? [])).toEqual(Array.from(blobData));
    });

    it('reassembles split blobs correctly', async () => {
      const largeSize = MAX_BLOB_CHUNK_SIZE + 1000; // Use smaller size for faster test
      const manifest = {
        ...createTestManifest(),
        blobCount: 1,
        blobTotalSize: largeSize
      };
      const database = createTestDatabase();
      const blobs: BlobEntry[] = [
        {
          path: 'large.bin',
          mimeType: 'application/octet-stream',
          size: largeSize
        }
      ];
      const blobData = new Uint8Array(largeSize);
      for (let i = 0; i < blobData.length; i++) {
        blobData[i] = i % 256;
      }
      const password = 'test-password';

      const encoded = await encode({
        password,
        manifest,
        database,
        blobs,
        readBlob: async () => blobData
      });

      const decoded = await decode({ data: encoded, password });

      expect(decoded.blobs).toHaveLength(1);
      const decodedBlob = decoded.blobs[0];
      expect(decodedBlob).toBeDefined();
      expect(decodedBlob?.data.length).toBe(largeSize);
      expect(Array.from(decodedBlob?.data ?? [])).toEqual(Array.from(blobData));
    }, 60000); // 60s timeout for large blob test

    it('throws InvalidPasswordError on wrong password', async () => {
      const manifest = createTestManifest();
      const database = createTestDatabase();

      const encoded = await encode({
        password: 'correct-password',
        manifest,
        database,
        blobs: [],
        readBlob: async () => new Uint8Array()
      });

      await expect(
        decode({ data: encoded, password: 'wrong-password' })
      ).rejects.toThrow(InvalidPasswordError);
    });

    it('calls progress callback during decoding', async () => {
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

      const progressEvents: Array<{ phase: string }> = [];

      await decode({
        data: encoded,
        password,
        onProgress: (event) => progressEvents.push({ phase: event.phase })
      });

      expect(progressEvents.some((e) => e.phase === 'preparing')).toBe(true);
      expect(progressEvents.some((e) => e.phase === 'database')).toBe(true);
    });

    it('handles unicode data in manifest and database', async () => {
      const manifest: BackupManifest = {
        ...createTestManifest(),
        instanceName: '测试实例 🎉'
      };
      const database: BackupDatabase = {
        tables: [{ name: 'users', sql: 'CREATE TABLE users (name TEXT)' }],
        indexes: [],
        data: {
          users: [{ name: '你好世界' }, { name: 'مرحبا' }]
        }
      };
      const password = 'test-password';

      const encoded = await encode({
        password,
        manifest,
        database,
        blobs: [],
        readBlob: async () => new Uint8Array()
      });

      const decoded = await decode({ data: encoded, password });

      expect(decoded.manifest.instanceName).toBe('测试实例 🎉');
      expect(decoded.database.data['users']).toEqual([
        { name: '你好世界' },
        { name: 'مرحبا' }
      ]);
    });
  });

  describe('validateBackup', () => {
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

      const result = await validateBackup(encoded, password);

      expect(result.valid).toBe(true);
      expect(result.manifest).toEqual(manifest);
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

      const result = await validateBackup(encoded, 'wrong-password');

      expect(result.valid).toBe(false);
      expect(result.error).toBe('Invalid password');
    });

    it('returns invalid for invalid file', async () => {
      const invalid = new Uint8Array(HEADER_SIZE);
      invalid.fill(0);

      const result = await validateBackup(invalid, 'any-password');

      expect(result.valid).toBe(false);
      expect(result.error).toContain('magic bytes');
    });

    it('returns invalid for empty backup (header only)', async () => {
      // Create a valid header but no chunks
      const header = new Uint8Array(HEADER_SIZE);
      header.set(MAGIC_BYTES, 0);
      header[MAGIC_SIZE] = 1; // version (little-endian)

      const result = await validateBackup(header, 'test-password');

      expect(result.valid).toBe(false);
      expect(result.error).toBe('No chunks in backup');
    });
  });
});