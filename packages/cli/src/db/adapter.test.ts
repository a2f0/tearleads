/**
 * Tests for NativeSqliteAdapter - verifies on-disk persistence.
 */

import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { setConfigRoot } from '../config/index.js';
import { NativeSqliteAdapter } from './adapter.js';

describe('NativeSqliteAdapter', () => {
  let tempDir: string;
  let adapter: NativeSqliteAdapter;
  const testKey = new Uint8Array(32).fill(42);

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'tearleads-dbtest-'));
    setConfigRoot(tempDir);
    adapter = new NativeSqliteAdapter();
  });

  afterEach(async () => {
    try {
      adapter.close();
    } catch {
      // Ignore
    }
    setConfigRoot(null);
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  describe('on-disk persistence', () => {
    it('creates database file on disk during initialize', async () => {
      await adapter.initialize(testKey);

      const dbPath = adapter.getPath();
      const stat = await fs.stat(dbPath);
      expect(stat.isFile()).toBe(true);
      expect(stat.size).toBeGreaterThan(0);
    });

    it('persists data across adapter instances', async () => {
      // Create and populate database
      await adapter.initialize(testKey);
      adapter.exec(
        "INSERT INTO contacts (name, email) VALUES ('Test User', 'test@example.com')"
      );
      adapter.close();

      // Create new adapter instance and verify data persists
      const adapter2 = new NativeSqliteAdapter();
      await adapter2.open(testKey);
      const data = adapter2.exportToJson();

      expect(data['contacts']).toHaveLength(1);
      expect((data['contacts'][0] as Record<string, unknown>)['name']).toBe(
        'Test User'
      );
      adapter2.close();
    });

    it('database survives simulated process restart', async () => {
      // Initialize and add data
      await adapter.initialize(testKey);
      adapter.exec(
        "INSERT INTO settings (key, value) VALUES ('theme', 'dark')"
      );
      adapter.close();

      // Simulate process restart by clearing all references
      adapter = null as unknown as NativeSqliteAdapter;

      // Create completely new adapter
      const freshAdapter = new NativeSqliteAdapter();
      await freshAdapter.open(testKey);

      const data = freshAdapter.exportToJson();
      expect(data['settings']).toHaveLength(1);
      expect((data['settings'][0] as Record<string, unknown>)['value']).toBe(
        'dark'
      );

      freshAdapter.close();
    });

    it('multiple operations persist correctly', async () => {
      await adapter.initialize(testKey);

      // Add multiple records
      adapter.exec(
        "INSERT INTO contacts (name) VALUES ('User 1'), ('User 2'), ('User 3')"
      );
      adapter.close();

      // Verify
      const adapter2 = new NativeSqliteAdapter();
      await adapter2.open(testKey);
      const data = adapter2.exportToJson();

      expect(data['contacts']).toHaveLength(3);
      adapter2.close();
    });
  });

  describe('encryption', () => {
    it('rejects wrong password on open', async () => {
      await adapter.initialize(testKey);
      adapter.close();

      const wrongKey = new Uint8Array(32).fill(99);
      const adapter2 = new NativeSqliteAdapter();

      await expect(adapter2.open(wrongKey)).rejects.toThrow(
        'Invalid encryption key'
      );
    });

    it('accepts correct password after initialize', async () => {
      await adapter.initialize(testKey);
      adapter.close();

      const adapter2 = new NativeSqliteAdapter();
      await expect(adapter2.open(testKey)).resolves.toBeUndefined();
      adapter2.close();
    });

    it('rekey changes encryption successfully', async () => {
      await adapter.initialize(testKey);
      adapter.exec("INSERT INTO contacts (name) VALUES ('Rekey Test')");

      const newKey = new Uint8Array(32).fill(123);
      await adapter.rekeyDatabase(newKey);
      adapter.close();

      // Old key should fail
      const adapter2 = new NativeSqliteAdapter();
      await expect(adapter2.open(testKey)).rejects.toThrow(
        'Invalid encryption key'
      );

      // New key should work
      const adapter3 = new NativeSqliteAdapter();
      await adapter3.open(newKey);
      const data = adapter3.exportToJson();
      expect(data['contacts']).toHaveLength(1);
      adapter3.close();
    });
  });

  describe('export/import', () => {
    it('exports all tables to JSON', async () => {
      await adapter.initialize(testKey);
      adapter.exec("INSERT INTO contacts (name) VALUES ('Export Test')");
      adapter.exec(
        "INSERT INTO settings (key, value) VALUES ('key1', 'value1')"
      );

      const data = adapter.exportToJson();

      expect(data).toHaveProperty('contacts');
      expect(data).toHaveProperty('settings');
      expect(data).toHaveProperty('events');
    });

    it('imports data correctly', async () => {
      await adapter.initialize(testKey);

      const importData = {
        contacts: [
          { id: 1, name: 'Imported User', email: 'imported@test.com' }
        ],
        settings: [{ key: 'imported', value: 'data' }]
      };

      adapter.importFromJson(importData);

      const exported = adapter.exportToJson();
      expect(exported['contacts']).toHaveLength(1);
      expect((exported['contacts'][0] as Record<string, unknown>)['name']).toBe(
        'Imported User'
      );
    });

    it('import clears existing data', async () => {
      await adapter.initialize(testKey);
      adapter.exec("INSERT INTO contacts (name) VALUES ('Original')");

      adapter.importFromJson({
        contacts: [{ id: 1, name: 'Replacement' }]
      });

      const exported = adapter.exportToJson();
      expect(exported['contacts']).toHaveLength(1);
      expect((exported['contacts'][0] as Record<string, unknown>)['name']).toBe(
        'Replacement'
      );
    });

    it('import skips empty arrays', async () => {
      await adapter.initialize(testKey);
      adapter.exec("INSERT INTO contacts (name) VALUES ('Keep Me')");

      // Import with empty contacts array - should skip, not clear
      adapter.importFromJson({
        contacts: []
      });

      const exported = adapter.exportToJson();
      // Original data should still be there since empty array is skipped
      expect(exported['contacts']).toHaveLength(1);
    });

    it('import skips non-array values', async () => {
      await adapter.initialize(testKey);
      adapter.exec("INSERT INTO contacts (name) VALUES ('Keep Me')");

      // Import with non-array value - should skip
      adapter.importFromJson({
        contacts: 'not an array' as unknown as unknown[]
      });

      const exported = adapter.exportToJson();
      expect(exported['contacts']).toHaveLength(1);
    });
  });

  describe('error handling', () => {
    it('throws when opening non-existent database', async () => {
      await expect(adapter.open(testKey)).rejects.toThrow(
        'Database file not found'
      );
    });

    it('throws when exporting from closed database', async () => {
      await adapter.initialize(testKey);
      adapter.close();

      expect(() => adapter.exportToJson()).toThrow('Database not open');
    });

    it('throws when importing to closed database', async () => {
      await adapter.initialize(testKey);
      adapter.close();

      expect(() => adapter.importFromJson({ contacts: [] })).toThrow(
        'Database not open'
      );
    });

    it('throws when rekeying closed database', async () => {
      await adapter.initialize(testKey);
      adapter.close();

      const newKey = new Uint8Array(32).fill(1);
      await expect(adapter.rekeyDatabase(newKey)).rejects.toThrow(
        'Database not open'
      );
    });

    it('throws when exec on closed database', async () => {
      await adapter.initialize(testKey);
      adapter.close();

      expect(() => adapter.exec('SELECT 1')).toThrow('Database not open');
    });
  });

  describe('isOpen', () => {
    it('returns false before initialize', () => {
      expect(adapter.isOpen()).toBe(false);
    });

    it('returns true after initialize', async () => {
      await adapter.initialize(testKey);
      expect(adapter.isOpen()).toBe(true);
    });

    it('returns false after close', async () => {
      await adapter.initialize(testKey);
      adapter.close();
      expect(adapter.isOpen()).toBe(false);
    });
  });
});
