import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { TestKeyManager } from '../testKeyManager.js';
import { WasmNodeAdapter } from './wasmNode.adapter.js';

describe('WasmNodeAdapter export/import', () => {
  let adapter: WasmNodeAdapter;

  beforeEach(() => {
    adapter = new WasmNodeAdapter();
  });

  afterEach(async () => {
    if (adapter.isOpen()) {
      await adapter.close();
    }
  });

  describe('exportDatabase', () => {
    beforeEach(async () => {
      await adapter.initialize({
        name: 'test-db',
        encryptionKey: TestKeyManager.getTestKey(),
        location: 'default'
      });
    });

    it('throws if not initialized', async () => {
      const newAdapter = new WasmNodeAdapter();
      await expect(newAdapter.exportDatabase()).rejects.toThrow(
        'Database not initialized'
      );
    });

    it('returns Uint8Array', async () => {
      const data = await adapter.exportDatabase();
      expect(data).toBeInstanceOf(Uint8Array);
    });
  });

  describe('exportDatabaseAsJson', () => {
    beforeEach(async () => {
      await adapter.initialize({
        name: 'test-db',
        encryptionKey: TestKeyManager.getTestKey(),
        location: 'default'
      });
    });

    it('throws if not initialized', async () => {
      const newAdapter = new WasmNodeAdapter();
      await expect(newAdapter.exportDatabaseAsJson()).rejects.toThrow(
        'Database not initialized'
      );
    });

    it('exports schema and data', async () => {
      await adapter.execute('CREATE TABLE test (id INTEGER, name TEXT)');
      await adapter.execute("INSERT INTO test VALUES (1, 'Alice')");

      const jsonStr = await adapter.exportDatabaseAsJson();
      const data = JSON.parse(jsonStr);

      expect(data.version).toBe(1);
      expect(data.tables).toContainEqual(
        expect.objectContaining({ name: 'test' })
      );
      expect(data.data.test).toEqual([{ id: 1, name: 'Alice' }]);
    });
  });

  describe('importDatabaseFromJson', () => {
    it('imports schema and data', async () => {
      await adapter.initialize({
        name: 'test-db',
        encryptionKey: TestKeyManager.getTestKey(),
        location: 'default'
      });
      await adapter.execute('CREATE TABLE test (id INTEGER, name TEXT)');
      await adapter.execute("INSERT INTO test VALUES (1, 'Alice')");

      const jsonStr = await adapter.exportDatabaseAsJson();
      await adapter.close();

      // Import into same adapter (creates new DB)
      await adapter.importDatabaseFromJson(
        jsonStr,
        TestKeyManager.getTestKey()
      );

      const result = await adapter.execute('SELECT * FROM test');
      expect(result.rows).toEqual([{ id: 1, name: 'Alice' }]);
    });

    it('throws on unsupported version', async () => {
      const badData = JSON.stringify({
        version: 999,
        tables: [],
        indexes: [],
        data: {}
      });

      await adapter.initialize({
        name: 'test-db',
        encryptionKey: TestKeyManager.getTestKey(),
        location: 'default'
      });

      await expect(
        adapter.importDatabaseFromJson(badData, TestKeyManager.getTestKey())
      ).rejects.toThrow('Unsupported backup version');
    });
  });

  describe('importDatabase', () => {
    it('imports JSON backup from Uint8Array', async () => {
      await adapter.initialize({
        name: 'test-db',
        encryptionKey: TestKeyManager.getTestKey(),
        location: 'default'
      });
      await adapter.execute('CREATE TABLE test (id INTEGER, name TEXT)');
      await adapter.execute("INSERT INTO test VALUES (1, 'Alice')");

      const jsonStr = await adapter.exportDatabaseAsJson();
      await adapter.close();

      const jsonBytes = new TextEncoder().encode(jsonStr);
      await adapter.importDatabase(jsonBytes, TestKeyManager.getTestKey());

      const result = await adapter.execute('SELECT * FROM test');
      expect(result.rows).toEqual([{ id: 1, name: 'Alice' }]);
    });

    it('throws on binary SQLite format', async () => {
      await adapter.initialize({
        name: 'test-db',
        encryptionKey: TestKeyManager.getTestKey(),
        location: 'default'
      });

      const binaryData = new Uint8Array([0x53, 0x51, 0x4c, 0x69]); // "SQLi"
      await expect(
        adapter.importDatabase(binaryData, TestKeyManager.getTestKey())
      ).rejects.toThrow('Binary SQLite database import is not supported');
    });
  });
});
