import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { TestKeyManager } from '../testKeyManager.js';
import { WasmNodeAdapter } from './wasmNode.adapter.js';

describe('WasmNodeAdapter', () => {
  let adapter: WasmNodeAdapter;

  beforeEach(() => {
    adapter = new WasmNodeAdapter();
  });

  afterEach(async () => {
    if (adapter.isOpen()) {
      await adapter.close();
    }
  });

  describe('initialize', () => {
    it('opens database with encryption', async () => {
      await adapter.initialize({
        name: 'test-db',
        encryptionKey: TestKeyManager.getTestKey(),
        location: 'default'
      });
      expect(adapter.isOpen()).toBe(true);
    });

    it('opens database without encryption when skipEncryption is true', async () => {
      adapter = new WasmNodeAdapter({ skipEncryption: true });
      await adapter.initialize({
        name: 'test-db-unencrypted',
        encryptionKey: TestKeyManager.getTestKey(),
        location: 'default'
      });
      expect(adapter.isOpen()).toBe(true);
    });

    it('throws if already initialized', async () => {
      await adapter.initialize({
        name: 'test-db',
        encryptionKey: TestKeyManager.getTestKey(),
        location: 'default'
      });
      await expect(
        adapter.initialize({
          name: 'test-db-2',
          encryptionKey: TestKeyManager.getTestKey(),
          location: 'default'
        })
      ).rejects.toThrow('Database already initialized');
    });
  });

  describe('close', () => {
    it('closes the database', async () => {
      await adapter.initialize({
        name: 'test-db',
        encryptionKey: TestKeyManager.getTestKey(),
        location: 'default'
      });
      expect(adapter.isOpen()).toBe(true);
      await adapter.close();
      expect(adapter.isOpen()).toBe(false);
    });

    it('is safe to call multiple times', async () => {
      await adapter.initialize({
        name: 'test-db',
        encryptionKey: TestKeyManager.getTestKey(),
        location: 'default'
      });
      await adapter.close();
      await adapter.close();
      expect(adapter.isOpen()).toBe(false);
    });
  });

  describe('execute', () => {
    beforeEach(async () => {
      await adapter.initialize({
        name: 'test-db',
        encryptionKey: TestKeyManager.getTestKey(),
        location: 'default'
      });
    });

    it('throws if not initialized', async () => {
      const newAdapter = new WasmNodeAdapter();
      await expect(newAdapter.execute('SELECT 1')).rejects.toThrow(
        'Database not initialized'
      );
    });

    it('executes SELECT queries', async () => {
      await adapter.execute('CREATE TABLE test (id INTEGER, name TEXT)');
      await adapter.execute("INSERT INTO test VALUES (1, 'Alice')");
      const result = await adapter.execute('SELECT * FROM test');
      expect(result.rows.length).toBe(1);
      expect(result.rows[0]).toEqual({ id: 1, name: 'Alice' });
    });

    it('executes PRAGMA queries', async () => {
      const result = await adapter.execute('PRAGMA foreign_keys');
      expect(result.rows.length).toBe(1);
    });

    it('executes INSERT and returns changes', async () => {
      await adapter.execute(
        'CREATE TABLE test (id INTEGER PRIMARY KEY, name TEXT)'
      );
      const result = await adapter.execute(
        "INSERT INTO test (name) VALUES ('Alice')"
      );
      expect(result.changes).toBe(1);
      expect(result.lastInsertRowId).toBe(1);
    });

    it('executes with parameters', async () => {
      await adapter.execute('CREATE TABLE test (id INTEGER, name TEXT)');
      await adapter.execute('INSERT INTO test VALUES (?, ?)', [1, 'Alice']);
      const result = await adapter.execute(
        'SELECT * FROM test WHERE id = ?',
        [1]
      );
      expect(result.rows.length).toBe(1);
    });
  });

  describe('executeMany', () => {
    beforeEach(async () => {
      await adapter.initialize({
        name: 'test-db',
        encryptionKey: TestKeyManager.getTestKey(),
        location: 'default'
      });
    });

    it('throws if not initialized', async () => {
      const newAdapter = new WasmNodeAdapter();
      await expect(newAdapter.executeMany(['SELECT 1'])).rejects.toThrow(
        'Database not initialized'
      );
    });

    it('executes multiple statements in transaction', async () => {
      await adapter.executeMany([
        'CREATE TABLE test (id INTEGER, name TEXT)',
        "INSERT INTO test VALUES (1, 'Alice')",
        "INSERT INTO test VALUES (2, 'Bob')"
      ]);
      const result = await adapter.execute('SELECT * FROM test');
      expect(result.rows.length).toBe(2);
    });

    it('rolls back on error', async () => {
      await adapter.execute(
        'CREATE TABLE test (id INTEGER PRIMARY KEY, name TEXT)'
      );
      await adapter.execute("INSERT INTO test VALUES (1, 'Alice')");

      await expect(
        adapter.executeMany([
          "INSERT INTO test VALUES (2, 'Bob')",
          "INSERT INTO test VALUES (1, 'Duplicate')" // Will fail
        ])
      ).rejects.toThrow();

      const result = await adapter.execute('SELECT * FROM test');
      expect(result.rows.length).toBe(1); // Rolled back
    });
  });

  describe('transactions', () => {
    beforeEach(async () => {
      await adapter.initialize({
        name: 'test-db',
        encryptionKey: TestKeyManager.getTestKey(),
        location: 'default'
      });
    });

    it('supports manual transactions', async () => {
      await adapter.execute('CREATE TABLE test (id INTEGER, name TEXT)');

      await adapter.beginTransaction();
      await adapter.execute("INSERT INTO test VALUES (1, 'Alice')");
      await adapter.commitTransaction();

      const result = await adapter.execute('SELECT * FROM test');
      expect(result.rows.length).toBe(1);
    });

    it('supports rollback', async () => {
      await adapter.execute('CREATE TABLE test (id INTEGER, name TEXT)');

      await adapter.beginTransaction();
      await adapter.execute("INSERT INTO test VALUES (1, 'Alice')");
      await adapter.rollbackTransaction();

      const result = await adapter.execute('SELECT * FROM test');
      expect(result.rows.length).toBe(0);
    });
  });

  describe('rekeyDatabase', () => {
    it('does nothing when skipEncryption is true', async () => {
      adapter = new WasmNodeAdapter({ skipEncryption: true });
      await adapter.initialize({
        name: 'test-db',
        encryptionKey: TestKeyManager.getTestKey(),
        location: 'default'
      });
      const newKey = new Uint8Array(32).fill(0xff);
      await expect(adapter.rekeyDatabase(newKey)).resolves.toBeUndefined();
    });

    it('throws if not initialized', async () => {
      const newKey = new Uint8Array(32).fill(0xff);
      await expect(adapter.rekeyDatabase(newKey)).rejects.toThrow(
        'Database not initialized'
      );
    });
  });

  describe('getConnection', () => {
    beforeEach(async () => {
      await adapter.initialize({
        name: 'test-db',
        encryptionKey: TestKeyManager.getTestKey(),
        location: 'default'
      });
    });

    it('returns a function for Drizzle', async () => {
      const connection = adapter.getConnection();
      expect(typeof connection).toBe('function');
    });

    it('connection function returns rows as arrays', async () => {
      await adapter.execute('CREATE TABLE test (id INTEGER, name TEXT)');
      await adapter.execute("INSERT INTO test VALUES (1, 'Alice')");

      const connection = adapter.getConnection() as (
        sql: string,
        params: unknown[],
        method: string
      ) => Promise<{ rows: unknown[] }>;
      const result = await connection('SELECT id, name FROM test', [], 'all');
      expect(result.rows).toEqual([[1, 'Alice']]);
    });
  });

  describe('deleteDatabase', () => {
    it('closes the database', async () => {
      await adapter.initialize({
        name: 'test-db',
        encryptionKey: TestKeyManager.getTestKey(),
        location: 'default'
      });
      await adapter.deleteDatabase('test-db');
      expect(adapter.isOpen()).toBe(false);
    });
  });
});
