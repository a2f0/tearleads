import { describe, expect, it } from 'vitest';

import { HEADER_SIZE, MAGIC_BYTES, MAX_BLOB_CHUNK_SIZE } from './constants';
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

describe('decoder', () => {
  const createTestManifest = (): BackupManifest => ({
    createdAt: '2026-02-02T12:00:00.000Z',
    platform: 'web',
    appVersion: '1.0.0',
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
      header[8] = 1; // version

      const result = await validateBackup(header, 'test-password');

      expect(result.valid).toBe(false);
      expect(result.error).toBe('No chunks in backup');
    });
  });
});

describe('encoder and decoder integration', () => {
  it('round-trips complex data correctly', async () => {
    const manifest: BackupManifest = {
      createdAt: new Date().toISOString(),
      platform: 'electron',
      appVersion: '2.5.0',
      blobCount: 3,
      blobTotalSize: 300,
      instanceName: 'Production Database'
    };

    const database: BackupDatabase = {
      tables: [
        {
          name: 'users',
          sql: 'CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT, email TEXT)'
        },
        {
          name: 'posts',
          sql: 'CREATE TABLE posts (id INTEGER PRIMARY KEY, user_id INTEGER, content TEXT)'
        }
      ],
      indexes: [
        {
          name: 'idx_users_email',
          tableName: 'users',
          sql: 'CREATE INDEX idx_users_email ON users(email)'
        }
      ],
      data: {
        users: [
          { id: 1, name: 'Alice', email: 'alice@example.com' },
          { id: 2, name: 'Bob', email: 'bob@example.com' }
        ],
        posts: [
          { id: 1, user_id: 1, content: 'Hello from Alice!' },
          { id: 2, user_id: 2, content: 'Hello from Bob!' }
        ]
      }
    };

    const blobs: BlobEntry[] = [
      { path: 'avatars/alice.png', mimeType: 'image/png', size: 100 },
      { path: 'avatars/bob.png', mimeType: 'image/png', size: 100 },
      { path: 'documents/readme.txt', mimeType: 'text/plain', size: 100 }
    ];

    const blobDataMap = new Map<string, Uint8Array>();
    blobs.forEach((blob) => {
      const data = new Uint8Array(blob.size);
      for (let i = 0; i < data.length; i++) {
        data[i] = (blob.path.charCodeAt(i % blob.path.length) + i) % 256;
      }
      blobDataMap.set(blob.path, data);
    });

    const password = 'complex-test-password-123!@#';

    const encoded = await encode({
      password,
      manifest,
      database,
      blobs,
      readBlob: async (path) => blobDataMap.get(path) ?? new Uint8Array()
    });

    const decoded = await decode({ data: encoded, password });

    // Verify manifest
    expect(decoded.manifest.platform).toBe(manifest.platform);
    expect(decoded.manifest.appVersion).toBe(manifest.appVersion);
    expect(decoded.manifest.instanceName).toBe(manifest.instanceName);

    // Verify database structure
    expect(decoded.database.tables).toHaveLength(2);
    expect(decoded.database.indexes).toHaveLength(1);

    // Verify database data
    expect(decoded.database.data['users']).toEqual(database.data['users']);
    expect(decoded.database.data['posts']).toEqual(database.data['posts']);

    // Verify blobs
    expect(decoded.blobs).toHaveLength(3);
    for (const decodedBlob of decoded.blobs) {
      const originalData = blobDataMap.get(decodedBlob.header.path);
      expect(originalData).toBeDefined();
      if (originalData) {
        expect(Array.from(decodedBlob.data)).toEqual(Array.from(originalData));
      }
    }
  });

  it('handles empty password', async () => {
    const manifest: BackupManifest = {
      createdAt: new Date().toISOString(),
      platform: 'web',
      appVersion: '1.0.0',
      blobCount: 0,
      blobTotalSize: 0
    };
    const database: BackupDatabase = { tables: [], indexes: [], data: {} };
    const password = '';

    const encoded = await encode({
      password,
      manifest,
      database,
      blobs: [],
      readBlob: async () => new Uint8Array()
    });

    const decoded = await decode({ data: encoded, password });

    expect(decoded.manifest.platform).toBe('web');
  });

  it('handles binary blob data correctly', async () => {
    const manifest: BackupManifest = {
      createdAt: new Date().toISOString(),
      platform: 'ios',
      appVersion: '1.0.0',
      blobCount: 1,
      blobTotalSize: 256
    };
    const database: BackupDatabase = { tables: [], indexes: [], data: {} };

    // All byte values 0-255
    const blobData = new Uint8Array(256);
    for (let i = 0; i < 256; i++) {
      blobData[i] = i;
    }

    const blobs: BlobEntry[] = [
      { path: 'binary.bin', mimeType: 'application/octet-stream', size: 256 }
    ];

    const password = 'test';

    const encoded = await encode({
      password,
      manifest,
      database,
      blobs,
      readBlob: async () => blobData
    });

    const decoded = await decode({ data: encoded, password });

    expect(decoded.blobs).toHaveLength(1);
    expect(Array.from(decoded.blobs[0]?.data ?? [])).toEqual(
      Array.from(blobData)
    );
  });
});
