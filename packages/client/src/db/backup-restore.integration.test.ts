/**
 * Integration tests for database backup and restore functionality.
 *
 * These tests specifically test the export/import cycle with encrypted databases
 * using the WasmNodeAdapter. This allows rapid debugging of backup/restore issues
 * without needing Playwright E2E tests.
 *
 * Related: https://github.com/a2f0/rapid/issues/137
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mockConsoleWarn } from '@/test/console-mocks';
import type { DatabaseConfig } from './adapters/types';
import { WasmNodeAdapter } from './adapters/wasm-node.adapter';

// Use a fixed test key for consistency
const TEST_ENCRYPTION_KEY = new Uint8Array([
  0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08, 0x09, 0x0a, 0x0b, 0x0c, 0x0d,
  0x0e, 0x0f, 0x10, 0x11, 0x12, 0x13, 0x14, 0x15, 0x16, 0x17, 0x18, 0x19, 0x1a,
  0x1b, 0x1c, 0x1d, 0x1e, 0x1f, 0x20
]);

function createTestConfig(name: string): DatabaseConfig {
  return {
    name,
    encryptionKey: TEST_ENCRYPTION_KEY
  };
}

describe('Backup/Restore Integration Tests', () => {
  let adapter: WasmNodeAdapter;
  let warnSpy: ReturnType<typeof mockConsoleWarn> | null = null;

  beforeEach(() => {
    warnSpy = mockConsoleWarn();
    adapter = new WasmNodeAdapter();
  });

  afterEach(async () => {
    if (adapter.isOpen()) {
      await adapter.close();
    }
    if (warnSpy) {
      const allowedWarnings = [
        'Ignoring inability to install OPFS sqlite3_vfs'
      ];
      const unexpectedWarnings = warnSpy.mock.calls.filter((call) => {
        const firstArg = call[0];
        const message =
          typeof firstArg === 'string'
            ? firstArg
            : firstArg instanceof Error
              ? firstArg.message
              : '';
        return !allowedWarnings.some((allowed) => message.includes(allowed));
      });

      expect(unexpectedWarnings).toEqual([]);
      warnSpy.mockRestore();
      warnSpy = null;
    }
  });

  describe('sqlite3 module capabilities', () => {
    it('exports UNENCRYPTED data even from encrypted database', async () => {
      // This test documents the behavior: sqlite3_js_db_export returns
      // UNENCRYPTED data because it serializes the in-memory pages
      await adapter.initialize(createTestConfig('explore-test'));

      const exported = await adapter.exportDatabase();

      // Check if it's the SQLite header (unencrypted)
      const headerStr = new TextDecoder().decode(exported.slice(0, 15));
      expect(headerStr).toBe('SQLite format 3');

      // This confirms sqlite3_js_db_export returns UNENCRYPTED data
      // even when the database was opened with an encryption key
    });

    it('binary sqlite3_deserialize does NOT work (known limitation)', async () => {
      // This test documents the limitation: sqlite3_deserialize
      // does not work with SQLite3MultipleCiphers WASM
      const sourceAdapter = new WasmNodeAdapter({ skipEncryption: true });

      try {
        await sourceAdapter.initialize({
          name: 'deserialize-test-source',
          encryptionKey: TEST_ENCRYPTION_KEY
        });

        await sourceAdapter.execute(`
          CREATE TABLE test_table (id INTEGER PRIMARY KEY, value TEXT)
        `);
        await sourceAdapter.execute(
          'INSERT INTO test_table (value) VALUES (?)',
          ['test-value']
        );

        // Export as binary (this uses sqlite3_js_db_export which works)
        const exported = await sourceAdapter.exportDatabase();
        await sourceAdapter.close();

        // Try to import - this should fail with our descriptive error
        const newAdapter = new WasmNodeAdapter({ skipEncryption: true });
        await newAdapter.initialize({
          name: 'deserialize-test-target',
          encryptionKey: TEST_ENCRYPTION_KEY
        });

        await expect(newAdapter.importDatabase(exported)).rejects.toThrow(
          'Binary SQLite database import is not supported'
        );

        await newAdapter.close();
      } finally {
        if (sourceAdapter.isOpen()) {
          await sourceAdapter.close();
        }
      }
    });

    it('JSON export/import round-trip works', async () => {
      // Test the JSON-based backup that works around the deserialize limitation
      await adapter.initialize(createTestConfig('json-roundtrip-source'));

      // Create data
      await adapter.execute(`
        CREATE TABLE test_table (id INTEGER PRIMARY KEY, value TEXT)
      `);
      await adapter.execute('INSERT INTO test_table (value) VALUES (?)', [
        'json-roundtrip-test-value'
      ]);

      // Export as JSON
      const jsonExport = await adapter.exportDatabaseAsJson();

      // Parse and verify structure
      const parsed = JSON.parse(jsonExport);
      expect(parsed.version).toBe(1);
      expect(parsed.tables).toHaveLength(1);
      expect(parsed.tables[0].name).toBe('test_table');

      await adapter.close();

      // Import into new adapter
      const newAdapter = new WasmNodeAdapter();
      try {
        // For JSON import, we need to call importDatabaseFromJson directly
        // (or pass the JSON as a Uint8Array which will be auto-detected)
        await newAdapter.importDatabaseFromJson(
          jsonExport,
          TEST_ENCRYPTION_KEY
        );

        // Verify data
        const result = await newAdapter.execute(
          'SELECT value FROM test_table WHERE id = 1'
        );
        expect(result.rows).toHaveLength(1);
        expect((result.rows[0] as Record<string, unknown>)['value']).toBe(
          'json-roundtrip-test-value'
        );
      } finally {
        await newAdapter.close();
      }
    });
  });

  describe('exportDatabase', () => {
    it('exports an encrypted database to bytes', async () => {
      await adapter.initialize(createTestConfig('export-test'));

      // Create a table and insert some data
      await adapter.execute(`
        CREATE TABLE IF NOT EXISTS test_data (
          id INTEGER PRIMARY KEY,
          value TEXT NOT NULL
        )
      `);
      await adapter.execute('INSERT INTO test_data (value) VALUES (?)', [
        'test-value-1'
      ]);

      // Export the database
      const exportedData = await adapter.exportDatabase();

      // Verify we got non-empty data
      expect(exportedData).toBeInstanceOf(Uint8Array);
      expect(exportedData.length).toBeGreaterThan(0);

      // sqlite3_js_db_export returns UNENCRYPTED data (serializes in-memory pages)
      // so the exported data has the standard SQLite header, not an encrypted one
      const header = new TextDecoder().decode(exportedData.slice(0, 15));
      expect(header).toBe('SQLite format 3');
    });
  });

  describe('JSON-based importDatabase', () => {
    it('imports an exported database and preserves data', async () => {
      // Step 1: Create and populate the original database
      await adapter.initialize(createTestConfig('import-test-original'));

      await adapter.execute(`
        CREATE TABLE IF NOT EXISTS test_data (
          id INTEGER PRIMARY KEY,
          value TEXT NOT NULL
        )
      `);

      const testValue = `test-value-${Date.now()}`;
      await adapter.execute('INSERT INTO test_data (value) VALUES (?)', [
        testValue
      ]);

      // Verify data was written
      const originalResult = await adapter.execute(
        'SELECT value FROM test_data WHERE id = 1'
      );
      expect(originalResult.rows).toHaveLength(1);
      expect((originalResult.rows[0] as Record<string, unknown>)['value']).toBe(
        testValue
      );

      // Step 2: Export the database as JSON
      const jsonExport = await adapter.exportDatabaseAsJson();

      // Step 3: Close the original adapter
      await adapter.close();

      // Step 4: Create a new adapter and import the data
      const newAdapter = new WasmNodeAdapter();
      try {
        // Import from JSON - creates a new encrypted database
        await newAdapter.importDatabaseFromJson(
          jsonExport,
          TEST_ENCRYPTION_KEY
        );

        // Step 5: Verify the data was restored
        const restoredResult = await newAdapter.execute(
          'SELECT value FROM test_data WHERE id = 1'
        );
        expect(restoredResult.rows).toHaveLength(1);
        expect(
          (restoredResult.rows[0] as Record<string, unknown>)['value']
        ).toBe(testValue);
      } finally {
        await newAdapter.close();
      }
    });

    it('handles import into a fresh adapter (not previously initialized)', async () => {
      // Step 1: Create and populate a database
      await adapter.initialize(createTestConfig('fresh-import-source'));

      await adapter.execute(`
        CREATE TABLE IF NOT EXISTS fresh_test (
          id INTEGER PRIMARY KEY,
          data TEXT NOT NULL
        )
      `);

      const testData = `fresh-test-data-${Date.now()}`;
      await adapter.execute('INSERT INTO fresh_test (data) VALUES (?)', [
        testData
      ]);

      // Export as JSON
      const jsonExport = await adapter.exportDatabaseAsJson();
      await adapter.close();

      // Step 2: Import into a brand new adapter
      // This tests the scenario where we restore a backup after app reinstall
      const freshAdapter = new WasmNodeAdapter();
      try {
        // Import directly from JSON - no need to initialize first!
        await freshAdapter.importDatabaseFromJson(
          jsonExport,
          TEST_ENCRYPTION_KEY
        );

        // Verify data
        const result = await freshAdapter.execute(
          'SELECT data FROM fresh_test WHERE id = 1'
        );
        expect(result.rows).toHaveLength(1);
        expect((result.rows[0] as Record<string, unknown>)['data']).toBe(
          testData
        );
      } finally {
        await freshAdapter.close();
      }
    });
  });

  describe('round-trip with multiple tables (JSON-based)', () => {
    it('preserves all tables and data through export/import cycle', async () => {
      await adapter.initialize(createTestConfig('roundtrip-test'));

      // Create multiple tables with different data types
      await adapter.execute(`
        CREATE TABLE IF NOT EXISTS users (
          id INTEGER PRIMARY KEY,
          name TEXT NOT NULL,
          email TEXT UNIQUE
        )
      `);

      await adapter.execute(`
        CREATE TABLE IF NOT EXISTS settings (
          key TEXT PRIMARY KEY,
          value TEXT,
          updated_at INTEGER
        )
      `);

      // Insert test data
      await adapter.execute('INSERT INTO users (name, email) VALUES (?, ?)', [
        'Test User',
        'test@example.com'
      ]);
      await adapter.execute(
        'INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)',
        ['theme', 'dark', Date.now()]
      );

      // Export as JSON
      const jsonExport = await adapter.exportDatabaseAsJson();
      await adapter.close();

      // Import into new adapter
      const newAdapter = new WasmNodeAdapter();
      try {
        await newAdapter.importDatabaseFromJson(
          jsonExport,
          TEST_ENCRYPTION_KEY
        );

        // Verify all tables exist and have correct data
        const usersResult = await newAdapter.execute('SELECT * FROM users');
        expect(usersResult.rows).toHaveLength(1);
        expect((usersResult.rows[0] as Record<string, unknown>)['name']).toBe(
          'Test User'
        );

        const settingsResult = await newAdapter.execute(
          'SELECT * FROM settings'
        );
        expect(settingsResult.rows).toHaveLength(1);
        expect(
          (settingsResult.rows[0] as Record<string, unknown>)['value']
        ).toBe('dark');

        // Verify table structure is preserved
        const tablesResult = await newAdapter.execute(
          "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
        );
        const tableNames = tablesResult.rows.map(
          (row: Record<string, unknown>) => row['name']
        );
        expect(tableNames).toContain('users');
        expect(tableNames).toContain('settings');
      } finally {
        await newAdapter.close();
      }
    });
  });

  describe('error cases', () => {
    it('throws when importing binary SQLite data (not supported)', async () => {
      await adapter.initialize(createTestConfig('binary-error-test'));

      // SQLite header bytes
      const sqliteHeader = new TextEncoder().encode('SQLite format 3');
      const binaryData = new Uint8Array(100);
      binaryData.set(sqliteHeader, 0);

      // Binary import is not supported with SQLite3MultipleCiphers WASM
      await expect(
        adapter.importDatabase(binaryData, TEST_ENCRYPTION_KEY)
      ).rejects.toThrow('Binary SQLite database import is not supported');
    });

    it('throws when importing corrupted JSON data', async () => {
      const freshAdapter = new WasmNodeAdapter();

      await expect(
        freshAdapter.importDatabaseFromJson(
          '{"version": 1, "tables": [CORRUPT',
          TEST_ENCRYPTION_KEY
        )
      ).rejects.toThrow('Failed to import database from JSON');
    });

    it('throws when importing unsupported JSON version', async () => {
      const freshAdapter = new WasmNodeAdapter();

      await expect(
        freshAdapter.importDatabaseFromJson(
          JSON.stringify({ version: 999, tables: [], indexes: [], data: {} }),
          TEST_ENCRYPTION_KEY
        )
      ).rejects.toThrow('Unsupported backup version: 999');
    });
  });
});
