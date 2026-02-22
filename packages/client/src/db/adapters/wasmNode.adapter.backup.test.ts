import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mockConsoleWarn } from '@/test/consoleMocks';

const TEST_KEY = new Uint8Array([1, 2, 3, 4]);

const createConfig = (name: string) => ({
  name,
  encryptionKey: TEST_KEY
});

describe('WasmNodeAdapter - JSON backup', () => {
  type WasmNodeAdapterClass =
    typeof import('./wasmNode.adapter').WasmNodeAdapter;
  type WasmNodeAdapterInstance = InstanceType<WasmNodeAdapterClass>;

  let WasmNodeAdapter: WasmNodeAdapterClass;
  let adapter: WasmNodeAdapterInstance;
  let warnSpy: ReturnType<typeof mockConsoleWarn>;

  beforeEach(async () => {
    const module = await import('./wasmNode.adapter');
    WasmNodeAdapter = module.WasmNodeAdapter;
    warnSpy = mockConsoleWarn();
    adapter = new WasmNodeAdapter({ skipEncryption: true });
  });

  afterEach(async () => {
    if (adapter.isOpen()) {
      await adapter.close();
    }
    warnSpy.mockRestore();
  });

  it('throws when exporting before initialization', async () => {
    await expect(adapter.exportDatabase()).rejects.toThrow(
      'Database not initialized'
    );
  });

  it('throws when exporting JSON before initialization', async () => {
    await expect(adapter.exportDatabaseAsJson()).rejects.toThrow(
      'Database not initialized'
    );
  });

  it('exports JSON including indexes', async () => {
    await adapter.initialize(createConfig('export-json'));
    await adapter.execute(
      'CREATE TABLE export_table (id INTEGER PRIMARY KEY, value TEXT)'
    );
    await adapter.execute('CREATE INDEX export_index ON export_table (value)');

    const json = await adapter.exportDatabaseAsJson();
    const parsed = JSON.parse(json);

    expect(parsed.indexes).toHaveLength(1);
    expect(parsed.indexes[0]?.name).toBe('export_index');
    expect(parsed.indexes[0]?.sql).toContain('CREATE INDEX');
  });

  it('skips invalid table and index rows during JSON export', async () => {
    const fakeDb = {
      exec: vi.fn(
        (
          options:
            | string
            | { callback?: (row: Record<string, unknown>) => void }
        ) => {
          if (typeof options === 'string') {
            return undefined;
          }
          options.callback?.({ name: 123, sql: null });
          return [];
        }
      ),
      close: vi.fn(() => undefined)
    };

    Object.defineProperty(adapter, 'db', {
      value: fakeDb,
      writable: true
    });

    const json = await adapter.exportDatabaseAsJson();
    const parsed = JSON.parse(json);

    expect(parsed.tables).toEqual([]);
    expect(parsed.indexes).toEqual([]);
  });

  it('imports JSON data and skips empty rows/indexes', async () => {
    const json = JSON.stringify({
      version: 1,
      tables: [
        {
          name: 'json_table',
          sql: 'CREATE TABLE json_table (id INTEGER PRIMARY KEY, value TEXT)'
        },
        {
          name: 'skip_table',
          sql: ''
        }
      ],
      indexes: [
        {
          name: 'skip_index',
          sql: ''
        }
      ],
      data: {
        json_table: [
          {
            id: 1,
            value: 'stored'
          },
          {}
        ]
      }
    });

    await adapter.importDatabaseFromJson(json, TEST_KEY);

    const result = await adapter.execute(
      'SELECT value FROM json_table ORDER BY id'
    );
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]?.['value']).toBe('stored');
  });

  it('imports JSON data with indexes', async () => {
    const json = JSON.stringify({
      version: 1,
      tables: [
        {
          name: 'indexed_table',
          sql: 'CREATE TABLE indexed_table (id INTEGER PRIMARY KEY, value TEXT)'
        }
      ],
      indexes: [
        {
          name: 'indexed_table_value',
          sql: 'CREATE INDEX indexed_table_value ON indexed_table (value)'
        }
      ],
      data: {
        indexed_table: [{ id: 1, value: 'ok' }]
      }
    });

    await adapter.importDatabaseFromJson(json, TEST_KEY);

    const result = await adapter.execute(
      "SELECT name FROM sqlite_master WHERE type='index' AND name='indexed_table_value'"
    );
    expect(result.rows).toHaveLength(1);
  });

  it('rolls back and closes when JSON import fails', async () => {
    const json = JSON.stringify({
      version: 1,
      tables: [
        {
          name: 'bad_table',
          sql: 'CREATE TABLE bad_table (id INTEGER PRIMARY KEY)'
        }
      ],
      indexes: [
        {
          name: 'bad_index',
          sql: 'CREATE INDEX bad_index'
        }
      ],
      data: {
        bad_table: [{ id: 1 }]
      }
    });

    await expect(
      adapter.importDatabaseFromJson(json, TEST_KEY)
    ).rejects.toThrow('Failed to import database from JSON');
    expect(adapter.isOpen()).toBe(false);
  });

  it('rejects JSON with unsupported version', async () => {
    const json = JSON.stringify({
      version: 2,
      tables: [],
      indexes: [],
      data: {}
    });

    await expect(
      adapter.importDatabaseFromJson(json, TEST_KEY)
    ).rejects.toThrow('Unsupported backup version');
  });

  it('rejects JSON with invalid structure', async () => {
    const json = JSON.stringify({
      tables: []
    });

    await expect(adapter.importDatabaseFromJson(json)).rejects.toThrow(
      'Invalid backup data format'
    );
  });

  it('importDatabase detects JSON and delegates to JSON import', async () => {
    const json = JSON.stringify({
      version: 1,
      tables: [
        {
          name: 'delegate_table',
          sql: 'CREATE TABLE delegate_table (value TEXT)'
        }
      ],
      indexes: [],
      data: {
        delegate_table: [{ value: 'delegated' }]
      }
    });

    const data = new TextEncoder().encode(json);
    await adapter.importDatabase(data, TEST_KEY);

    const result = await adapter.execute('SELECT value FROM delegate_table');
    expect(result.rows[0]?.['value']).toBe('delegated');
  });

  it('importDatabase rejects binary data', async () => {
    const data = new Uint8Array([0, 1, 2, 3]);
    await expect(adapter.importDatabase(data)).rejects.toThrow(
      'Binary SQLite database import is not supported'
    );
  });

  it('wraps non-error failures when importing JSON', async () => {
    const modulePath = path.resolve(
      process.cwd(),
      'src/workers/sqlite-wasm/sqlite3.js'
    );

    vi.doMock(modulePath, () => ({
      default: async () => ({
        oo1: {
          DB: () => ({
            exec: () => {
              throw 'boom';
            },
            close: () => undefined
          })
        },
        capi: {}
      })
    }));
    vi.resetModules();
    const module = await import('./wasmNode.adapter');

    const existsSpy = vi.spyOn(fs, 'existsSync');
    existsSpy.mockReturnValue(true);

    const failingAdapter = new module.WasmNodeAdapter();
    const json = JSON.stringify({
      version: 1,
      tables: [
        {
          name: 'error_table',
          sql: 'CREATE TABLE error_table (id INTEGER PRIMARY KEY)'
        }
      ],
      indexes: [],
      data: {}
    });

    await expect(
      failingAdapter.importDatabaseFromJson(json, TEST_KEY)
    ).rejects.toThrow('Failed to import database from JSON');

    existsSpy.mockRestore();
    vi.doUnmock(modulePath);
    vi.resetModules();
  });
});
