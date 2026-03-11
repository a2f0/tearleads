import fs from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mockConsoleWarn } from '@/test/consoleMocks';
import {
  getStringField,
  isJsonBackupData,
  restoreFetch
} from './wasmNode/utils';

const TEST_KEY = new Uint8Array([1, 2, 3, 4]);

const createConfig = (name: string) => ({
  name,
  encryptionKey: TEST_KEY
});
describe('WasmNodeAdapter', () => {
  type WasmNodeAdapterClass =
    typeof import('./wasmNode.adapter').WasmNodeAdapter;
  type WasmNodeAdapterInstance = InstanceType<WasmNodeAdapterClass>;

  let WasmNodeAdapter: WasmNodeAdapterClass;
  let adapter: WasmNodeAdapterInstance;
  let warnSpy: ReturnType<typeof mockConsoleWarn>;

  beforeEach(async () => {
    const sqliteWasmRuntime = await import('./wasmNode/initializeSqliteWasm');
    sqliteWasmRuntime.resetSqliteWasmRuntimeForTesting();

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

    const sqliteWasmRuntime = await import('./wasmNode/initializeSqliteWasm');
    sqliteWasmRuntime.resetSqliteWasmRuntimeForTesting();
  });

  it('leaves fetch unchanged when restore is called without patching', async () => {
    const originalFetch = globalThis.fetch;

    try {
      Object.defineProperty(globalThis, 'fetch', {
        value: undefined,
        writable: true,
        configurable: true
      });

      restoreFetch();
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
    const existsSpy = vi.spyOn(fs, 'existsSync');
    existsSpy.mockReturnValueOnce(false);

    const { initializeSqliteWasm } = await import(
      './wasmNode/initializeSqliteWasm'
    );
    await expect(initializeSqliteWasm()).rejects.toThrow(
      'SQLite WASM module not found'
    );

    existsSpy.mockRestore();
  });

  it('throws when sqlite3 wasm file is missing', async () => {
    const existsSpy = vi.spyOn(fs, 'existsSync');
    existsSpy.mockReturnValueOnce(true).mockReturnValueOnce(false);

    const { initializeSqliteWasm } = await import(
      './wasmNode/initializeSqliteWasm'
    );
    await expect(initializeSqliteWasm()).rejects.toThrow(
      'SQLite WASM binary not found'
    );

    existsSpy.mockRestore();
  });

  it('throws when sqlite3 module export is missing', async () => {
    const sqliteWasmRuntime = await import('./wasmNode/initializeSqliteWasm');
    sqliteWasmRuntime.setSqliteWasmModuleImporterForTesting(async () => ({
      default: undefined
    }));

    const existsSpy = vi.spyOn(fs, 'existsSync');
    existsSpy.mockReturnValue(true);

    await expect(sqliteWasmRuntime.initializeSqliteWasm()).rejects.toThrow(
      'Failed to load sqlite3InitModule from module'
    );

    existsSpy.mockRestore();
  });

  it('throws when sqlite3 module is missing required properties', async () => {
    const sqliteWasmRuntime = await import('./wasmNode/initializeSqliteWasm');
    sqliteWasmRuntime.setSqliteWasmModuleImporterForTesting(async () => ({
      default: async () => ({})
    }));

    const existsSpy = vi.spyOn(fs, 'existsSync');
    existsSpy.mockReturnValue(true);

    await expect(sqliteWasmRuntime.initializeSqliteWasm()).rejects.toThrow(
      'SQLite module loaded but missing expected properties'
    );

    existsSpy.mockRestore();
  });

  it('wraps errors when opening encrypted databases', async () => {
    const sqliteWasmRuntime = await import('./wasmNode/initializeSqliteWasm');
    sqliteWasmRuntime.setSqliteWasmModuleImporterForTesting(async () => ({
      default: async () => ({
        oo1: {
          DB: () => {
            throw new Error('boom');
          }
        },
        capi: {}
      })
    }));
    const module = await import('./wasmNode.adapter');

    const existsSpy = vi.spyOn(fs, 'existsSync');
    existsSpy.mockReturnValue(true);

    const failingAdapter = new module.WasmNodeAdapter();
    await expect(
      failingAdapter.initialize(createConfig('open-failure'))
    ).rejects.toThrow('Failed to open encrypted database');

    existsSpy.mockRestore();
  });

  it('wraps non-error failures when opening encrypted databases', async () => {
    const sqliteWasmRuntime = await import('./wasmNode/initializeSqliteWasm');
    sqliteWasmRuntime.setSqliteWasmModuleImporterForTesting(async () => ({
      default: async () => ({
        oo1: {
          DB: () => {
            throw 'boom';
          }
        },
        capi: {}
      })
    }));
    const module = await import('./wasmNode.adapter');

    const existsSpy = vi.spyOn(fs, 'existsSync');
    existsSpy.mockReturnValue(true);

    const failingAdapter = new module.WasmNodeAdapter();
    await expect(
      failingAdapter.initialize(createConfig('open-failure-nonerror'))
    ).rejects.toThrow('Failed to open encrypted database');

    existsSpy.mockRestore();
  });

  it('wraps non-error failures when importing JSON', async () => {
    const sqliteWasmRuntime = await import('./wasmNode/initializeSqliteWasm');
    sqliteWasmRuntime.setSqliteWasmModuleImporterForTesting(async () => ({
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
  });
});
