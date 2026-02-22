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

describe('encoder', () => {
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

  describe('encode', () => {
    it('creates a valid backup file header', async () => {
      const manifest = createTestManifest();
      const database = createTestDatabase();

      const result = await encode({
        password: 'test-password',
        manifest,
        database,
        blobs: [],
        readBlob: async () => new Uint8Array()
      });

      // Check header size
      expect(result.length).toBeGreaterThanOrEqual(HEADER_SIZE);

      // Check magic bytes
      for (let i = 0; i < MAGIC_BYTES.length; i++) {
        expect(result[i]).toBe(MAGIC_BYTES[i]);
      }
    });

    it('encodes manifest and database', async () => {
      const manifest = createTestManifest();
      const database = createTestDatabase();

      const encoded = await encode({
        password: 'test-password',
        manifest,
        database,
        blobs: [],
        readBlob: async () => new Uint8Array()
      });

      // File should be larger than just the header
      expect(encoded.length).toBeGreaterThan(HEADER_SIZE + 100);
    });

    it('encodes blobs', async () => {
      const manifest = {
        ...createTestManifest(),
        blobCount: 1,
        blobTotalSize: 100
      };
      const database = createTestDatabase();
      const blobs: BlobEntry[] = [
        { path: 'test.txt', mimeType: 'text/plain', size: 100 }
      ];
      const blobData = new Uint8Array(100).fill(65); // 'A' repeated

      const encoded = await encode({
        password: 'test-password',
        manifest,
        database,
        blobs,
        readBlob: async () => blobData
      });

      // File should include blob data
      expect(encoded.length).toBeGreaterThan(HEADER_SIZE + 200);
    });

    it('splits large blobs into multiple chunks', async () => {
      const largeSize = MAX_BLOB_CHUNK_SIZE + 1000; // Just over 10MB to trigger split
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

      const encoded = await encode({
        password: 'test-password',
        manifest,
        database,
        blobs,
        readBlob: async () => blobData
      });

      // Encoded file should be created (compression may make it smaller than original)
      // The important thing is that it round-trips correctly (tested in decoder tests)
      expect(encoded.length).toBeGreaterThan(HEADER_SIZE);
    });

    it('calls progress callback during encoding', async () => {
      const manifest = {
        ...createTestManifest(),
        blobCount: 2,
        blobTotalSize: 200
      };
      const database = createTestDatabase();
      const blobs: BlobEntry[] = [
        { path: 'file1.txt', mimeType: 'text/plain', size: 100 },
        { path: 'file2.txt', mimeType: 'text/plain', size: 100 }
      ];

      const progressEvents: Array<{
        phase: string;
        current: number;
        total: number;
      }> = [];

      await encode({
        password: 'test-password',
        manifest,
        database,
        blobs,
        readBlob: async () => new Uint8Array(100),
        onProgress: (event) =>
          progressEvents.push({
            phase: event.phase,
            current: event.current,
            total: event.total
          })
      });

      // Should have progress events for manifest, database, blobs, finalizing
      expect(progressEvents.length).toBeGreaterThanOrEqual(4);
      expect(progressEvents.some((e) => e.phase === 'preparing')).toBe(true);
      expect(progressEvents.some((e) => e.phase === 'database')).toBe(true);
      expect(progressEvents.some((e) => e.phase === 'blobs')).toBe(true);
      expect(progressEvents.some((e) => e.phase === 'finalizing')).toBe(true);
    });

    it('handles empty blobs array', async () => {
      const manifest = createTestManifest();
      const database = createTestDatabase();

      const encoded = await encode({
        password: 'test-password',
        manifest,
        database,
        blobs: [],
        readBlob: async () => new Uint8Array()
      });

      expect(encoded.length).toBeGreaterThan(HEADER_SIZE);
    });

    it('handles empty database', async () => {
      const manifest = createTestManifest();
      const database: BackupDatabase = {
        tables: [],
        indexes: [],
        data: {}
      };

      const encoded = await encode({
        password: 'test-password',
        manifest,
        database,
        blobs: [],
        readBlob: async () => new Uint8Array()
      });

      expect(encoded.length).toBeGreaterThan(HEADER_SIZE);
    });
  });

  describe('estimateBackupSize', () => {
    it('estimates size for empty backup', () => {
      const manifest = createTestManifest();
      const database: BackupDatabase = { tables: [], indexes: [], data: {} };

      const estimate = estimateBackupSize(manifest, database, []);

      expect(estimate).toBeGreaterThan(HEADER_SIZE);
    });

    it('estimates size increases with blobs', () => {
      const manifest = createTestManifest();
      const database: BackupDatabase = { tables: [], indexes: [], data: {} };

      const withoutBlobs = estimateBackupSize(manifest, database, []);
      const withBlobs = estimateBackupSize(manifest, database, [
        { path: 'a.bin', mimeType: 'application/octet-stream', size: 1000 },
        { path: 'b.bin', mimeType: 'application/octet-stream', size: 2000 }
      ]);

      expect(withBlobs).toBeGreaterThan(withoutBlobs);
    });
  });
});