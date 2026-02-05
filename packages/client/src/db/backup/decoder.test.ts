import { describe, expect, it } from 'vitest';
import { FORMAT_VERSION, MAGIC_BYTES } from './constants';
import {
  BackupDecodeError,
  decode,
  InvalidPasswordError,
  readHeader,
  validateBackup
} from './decoder';
import { encode } from './encoder';
import type { BackupDatabase, BackupManifest } from './types';

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
    indexes: [],
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
      const password = 'test-password';

      const encoded = await encode({
        password,
        manifest,
        database,
        blobs: [],
        readBlob: async () => new Uint8Array()
      });

      const header = readHeader(encoded);

      // Check magic bytes
      expect(Array.from(header.magic)).toEqual(Array.from(MAGIC_BYTES));
      expect(header.version).toBe(1);
      expect(header.salt.length).toBe(16);
    });

    it('throws on file too small', () => {
      const tooSmall = new Uint8Array(10);
      expect(() => readHeader(tooSmall)).toThrow(BackupDecodeError);
    });

    it('throws on invalid magic bytes', () => {
      const invalid = new Uint8Array(32).fill(0);
      expect(() => readHeader(invalid)).toThrow('wrong magic bytes');
    });
  });

  describe('decode', () => {
    it('decodes a valid backup', async () => {
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

    it('throws InvalidPasswordError for wrong password', async () => {
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

    it('calls progress callback', async () => {
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

      const phases: string[] = [];

      await decode({
        data: encoded,
        password,
        onProgress: (event) => phases.push(event.phase)
      });

      expect(phases).toContain('preparing');
      expect(phases).toContain('database');
    });
  });

  describe('validateBackup', () => {
    it('returns valid with manifest for correct password', async () => {
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
      expect(result.manifest).toBeDefined();
      expect(result.manifest?.platform).toBe('web');
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

    it('returns invalid for corrupted header', async () => {
      const corrupted = new Uint8Array(32).fill(0);
      const result = await validateBackup(corrupted, 'any-password');

      expect(result.valid).toBe(false);
      expect(result.error).toContain('magic bytes');
    });

    it('returns invalid for truncated file', async () => {
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

      // Truncate the file after the header
      const truncated = encoded.slice(0, 33);
      const result = await validateBackup(truncated, password);

      expect(result.valid).toBe(false);
    });
  });
});
