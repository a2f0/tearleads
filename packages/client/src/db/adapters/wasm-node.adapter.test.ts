import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mockConsoleWarn } from '@/test/console-mocks';

const TEST_KEY = new Uint8Array([1, 2, 3, 4]);

const createConfig = (name: string) => ({
  name,
  encryptionKey: TEST_KEY
});

describe('WasmNodeAdapter', () => {
  type WasmNodeAdapterClass =
    typeof import('./wasm-node.adapter').WasmNodeAdapter;
  type WasmNodeAdapterInstance = InstanceType<WasmNodeAdapterClass>;

  let WasmNodeAdapter: WasmNodeAdapterClass;
  let adapter: WasmNodeAdapterInstance;
  let warnSpy: ReturnType<typeof mockConsoleWarn>;

  beforeEach(async () => {
    const module = await import('./wasm-node.adapter');
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

  it('initializes once and rejects double initialization', async () => {
    await adapter.initialize(createConfig('init-once'));

    await expect(
      adapter.initialize(createConfig('init-twice'))
    ).rejects.toThrow('Database already initialized');
  });

  it('executes select and non-select queries', async () => {
    await adapter.initialize(createConfig('query-test'));

    await adapter.execute(
      'CREATE TABLE test (id INTEGER PRIMARY KEY, value TEXT)'
    );
    const insertResult = await adapter.execute(
      'INSERT INTO test (value) VALUES (?)',
      ['hello']
    );

    expect(insertResult.changes).toBe(1);
    expect(insertResult.lastInsertRowId).toBeGreaterThan(0);

    const selectResult = await adapter.execute(
      'SELECT value FROM test WHERE id = ?',
      [insertResult.lastInsertRowId]
    );

    expect(selectResult.rows).toHaveLength(1);
    expect(selectResult.rows[0]?.['value']).toBe('hello');
  });

  it('executes statements in a transaction and rolls back on error', async () => {
    await adapter.initialize(createConfig('execute-many'));

    await expect(
      adapter.executeMany([
        'CREATE TABLE rollback_test (id INTEGER PRIMARY KEY, value TEXT)',
        "INSERT INTO rollback_test (value) VALUES ('ok')",
        'INVALID SQL'
      ])
    ).rejects.toBeDefined();

    const result = await adapter.execute(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='rollback_test'"
    );
    expect(result.rows).toHaveLength(0);
  });

  it('commits explicit transactions', async () => {
    await adapter.initialize(createConfig('commit-tx'));

    await adapter.beginTransaction();
    await adapter.execute('CREATE TABLE commit_test (id INTEGER PRIMARY KEY)');
    await adapter.commitTransaction();

    const result = await adapter.execute(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='commit_test'"
    );
    expect(result.rows).toHaveLength(1);
  });

  it('supports explicit transaction helpers', async () => {
    await adapter.initialize(createConfig('tx-helpers'));

    await adapter.beginTransaction();
    await adapter.execute('CREATE TABLE tx_test (id INTEGER PRIMARY KEY)');
    await adapter.rollbackTransaction();

    const result = await adapter.execute(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='tx_test'"
    );
    expect(result.rows).toHaveLength(0);
  });

  it('handles rekeying when encryption is skipped', async () => {
    await adapter.initialize(createConfig('rekey-skip'));
    await adapter.rekeyDatabase(new Uint8Array([9, 8, 7, 6]));
  });

  it('throws when rekeying before initialization', async () => {
    await expect(
      adapter.rekeyDatabase(new Uint8Array([9, 8, 7, 6]))
    ).rejects.toThrow('Database not initialized');
  });

  it('rekeys database when encryption is enabled', async () => {
    const encryptedAdapter = new WasmNodeAdapter();
    await encryptedAdapter.initialize(createConfig('rekey-enabled'));
    await encryptedAdapter.rekeyDatabase(new Uint8Array([6, 7, 8, 9]));
    await encryptedAdapter.close();
  });

  it('returns sqlite-proxy compatible rows via getConnection', async () => {
    await adapter.initialize(createConfig('proxy'));
    await adapter.execute('CREATE TABLE proxy_test (id INTEGER, value TEXT)');
    await adapter.execute('INSERT INTO proxy_test (id, value) VALUES (?, ?)', [
      7,
      'row'
    ]);

    const connection = adapter.getConnection();
    if (typeof connection !== 'function') {
      throw new Error('Expected connection to be a function');
    }

    const result = await connection(
      'SELECT id, value FROM proxy_test ORDER BY id',
      [],
      'all'
    );

    expect(result.rows).toEqual([[7, 'row']]);
  });

  it('throws when executing before initialization', async () => {
    await expect(adapter.execute('SELECT 1')).rejects.toThrow(
      'Database not initialized'
    );
  });

  it('defaults lastInsertRowId when sqlite returns no rows', async () => {
    const fakeDb = {
      exec: vi.fn((arg: string | { sql: string }) => {
        if (typeof arg === 'string') {
          return undefined;
        }
        if (arg.sql === 'SELECT last_insert_rowid()') {
          return [];
        }
        return undefined;
      }),
      changes: vi.fn(() => 0),
      close: vi.fn(() => undefined)
    };

    Object.defineProperty(adapter, 'db', {
      value: fakeDb,
      writable: true
    });

    const result = await adapter.execute('UPDATE test SET value = 1');

    expect(result.lastInsertRowId).toBe(0);
  });

  it('throws when executing many before initialization', async () => {
    await expect(adapter.executeMany(['SELECT 1'])).rejects.toThrow(
      'Database not initialized'
    );
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

  it('handles patching fetch for file and non-file URLs', async () => {
    const originalFetch = globalThis.fetch;
    const fetchSpy = vi.fn(async () => new Response('ok'));
    globalThis.fetch = fetchSpy;

    vi.resetModules();
    const module = await import('./wasm-node.adapter');

    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rapid-wasm-'));
    const tempFile = path.join(tempDir, 'test.wasm');
    fs.writeFileSync(tempFile, 'wasm');

    module.__test__.patchFetchForFileUrls();

    const fileResponse = await globalThis.fetch(pathToFileURL(tempFile));
    expect(await fileResponse.text()).toBe('wasm');

    await globalThis.fetch('https://example.com');
    expect(fetchSpy).toHaveBeenCalled();

    module.__test__.restoreFetch();
    globalThis.fetch = originalFetch;
  });

  it('leaves fetch unchanged when restore is called without patching', async () => {
    const originalFetch = globalThis.fetch;

    try {
      Object.defineProperty(globalThis, 'fetch', {
        value: undefined,
        writable: true,
        configurable: true
      });

      vi.resetModules();
      const module = await import('./wasm-node.adapter');

      module.__test__.restoreFetch();
    } finally {
      Object.defineProperty(globalThis, 'fetch', {
        value: originalFetch,
        writable: true,
        configurable: true
      });
    }

    expect(globalThis.fetch).toBe(originalFetch);
  });

  it('validates JSON backup shape helpers', async () => {
    const module = await import('./wasm-node.adapter');
    const { getStringField, isJsonBackupData } = module.__test__;

    expect(getStringField({ name: 123 }, 'name')).toBeNull();

    expect(isJsonBackupData(null)).toBe(false);
    expect(
      isJsonBackupData({
        version: 1,
        tables: 'nope',
        indexes: [],
        data: {}
      })
    ).toBe(false);
    expect(
      isJsonBackupData({
        version: 1,
        tables: [],
        indexes: [{ name: 1, sql: 'nope' }],
        data: {}
      })
    ).toBe(false);
    expect(
      isJsonBackupData({
        version: 1,
        tables: [],
        indexes: [],
        data: 'nope'
      })
    ).toBe(false);
    expect(
      isJsonBackupData({
        version: 1,
        tables: [],
        indexes: [],
        data: {
          bad_table: 'nope'
        }
      })
    ).toBe(false);
    expect(
      isJsonBackupData({
        version: 1,
        tables: [],
        indexes: [],
        data: {
          bad_table: [null]
        }
      })
    ).toBe(false);
  });

  it('throws when sqlite3 module file is missing', async () => {
    vi.resetModules();
    const module = await import('./wasm-node.adapter');

    const existsSpy = vi.spyOn(fs, 'existsSync');
    existsSpy.mockReturnValueOnce(false);

    await expect(module.__test__.initializeSqliteWasm()).rejects.toThrow(
      'SQLite WASM module not found'
    );

    existsSpy.mockRestore();
  });

  it('throws when sqlite3 wasm file is missing', async () => {
    vi.resetModules();
    const module = await import('./wasm-node.adapter');

    const existsSpy = vi.spyOn(fs, 'existsSync');
    existsSpy.mockReturnValueOnce(true).mockReturnValueOnce(false);

    await expect(module.__test__.initializeSqliteWasm()).rejects.toThrow(
      'SQLite WASM binary not found'
    );

    existsSpy.mockRestore();
  });

  it('throws when sqlite3 module export is missing', async () => {
    const modulePath = path.resolve(
      process.cwd(),
      'src/workers/sqlite-wasm/sqlite3.js'
    );

    vi.doMock(modulePath, () => ({ default: undefined }));
    vi.resetModules();
    const module = await import('./wasm-node.adapter');

    const existsSpy = vi.spyOn(fs, 'existsSync');
    existsSpy.mockReturnValue(true);

    await expect(module.__test__.initializeSqliteWasm()).rejects.toThrow(
      'Failed to load sqlite3InitModule from module'
    );

    existsSpy.mockRestore();
    vi.doUnmock(modulePath);
    vi.resetModules();
  });

  it('throws when sqlite3 module is missing required properties', async () => {
    const modulePath = path.resolve(
      process.cwd(),
      'src/workers/sqlite-wasm/sqlite3.js'
    );

    vi.doMock(modulePath, () => ({
      default: async () => ({})
    }));
    vi.resetModules();
    const module = await import('./wasm-node.adapter');

    const existsSpy = vi.spyOn(fs, 'existsSync');
    existsSpy.mockReturnValue(true);

    await expect(module.__test__.initializeSqliteWasm()).rejects.toThrow(
      'SQLite module loaded but missing expected properties'
    );

    existsSpy.mockRestore();
    vi.doUnmock(modulePath);
    vi.resetModules();
  });

  it('wraps errors when opening encrypted databases', async () => {
    const modulePath = path.resolve(
      process.cwd(),
      'src/workers/sqlite-wasm/sqlite3.js'
    );

    vi.doMock(modulePath, () => ({
      default: async () => ({
        oo1: {
          DB: () => {
            throw new Error('boom');
          }
        },
        capi: {}
      })
    }));
    vi.resetModules();
    const module = await import('./wasm-node.adapter');

    const existsSpy = vi.spyOn(fs, 'existsSync');
    existsSpy.mockReturnValue(true);

    const failingAdapter = new module.WasmNodeAdapter();
    await expect(
      failingAdapter.initialize(createConfig('open-failure'))
    ).rejects.toThrow('Failed to open encrypted database');

    existsSpy.mockRestore();
    vi.doUnmock(modulePath);
    vi.resetModules();
  });

  it('wraps non-error failures when opening encrypted databases', async () => {
    const modulePath = path.resolve(
      process.cwd(),
      'src/workers/sqlite-wasm/sqlite3.js'
    );

    vi.doMock(modulePath, () => ({
      default: async () => ({
        oo1: {
          DB: () => {
            throw 'boom';
          }
        },
        capi: {}
      })
    }));
    vi.resetModules();
    const module = await import('./wasm-node.adapter');

    const existsSpy = vi.spyOn(fs, 'existsSync');
    existsSpy.mockReturnValue(true);

    const failingAdapter = new module.WasmNodeAdapter();
    await expect(
      failingAdapter.initialize(createConfig('open-failure-nonerror'))
    ).rejects.toThrow('Failed to open encrypted database');

    existsSpy.mockRestore();
    vi.doUnmock(modulePath);
    vi.resetModules();
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
    const module = await import('./wasm-node.adapter');

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
