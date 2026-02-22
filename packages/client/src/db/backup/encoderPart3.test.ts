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

describe('encoder and decoder integration', () => {
  it('round-trips complex data correctly', async () => {
    const manifest: BackupManifest = {
      createdAt: new Date().toISOString(),
      platform: 'electron',
      appVersion: '2.5.0',
      formatVersion: FORMAT_VERSION,
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
      formatVersion: FORMAT_VERSION,
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
      formatVersion: FORMAT_VERSION,
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