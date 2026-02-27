import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mockConsoleWarn } from '@/test/consoleMocks';
import { getStringField, isJsonBackupData } from './wasmNode/utils';

const TEST_KEY = new Uint8Array([1, 2, 3, 4]);

const createConfig = (name: string) => ({
  name,
  encryptionKey: TEST_KEY
});

describe('WasmNodeAdapter - WASM initialization and utilities', () => {
  let warnSpy: ReturnType<typeof mockConsoleWarn>;

  beforeEach(() => {
    warnSpy = mockConsoleWarn();
  });

  afterEach(() => {
    warnSpy.mockRestore();
  });

  it('handles patching fetch for file and non-file URLs', async () => {
    const originalFetch = globalThis.fetch;
    const fetchSpy = vi.fn(async () => new Response('ok'));
    globalThis.fetch = fetchSpy;

    vi.resetModules();
    const utils = await import('./wasmNode/utils');

    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tearleads-wasm-'));
    const tempFile = path.join(tempDir, 'test.wasm');
    fs.writeFileSync(tempFile, 'wasm');

    utils.patchFetchForFileUrls();

    const fileResponse = await globalThis.fetch(pathToFileURL(tempFile).href);
    expect(await fileResponse.text()).toBe('ok');
    expect(fetchSpy).toHaveBeenCalledWith(
      expect.stringMatching(/^data:application\/wasm;base64,/),
      undefined
    );

    await globalThis.fetch('https://example.com');
    expect(fetchSpy).toHaveBeenCalled();

    utils.restoreFetch();
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
      const utils = await import('./wasmNode/utils');

      utils.restoreFetch();
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
    await import('./wasmNode.adapter');

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
    const { initializeSqliteWasm: initWasm } = await import(
      './wasmNode/initializeSqliteWasm'
    );

    const existsSpy = vi.spyOn(fs, 'existsSync');
    existsSpy.mockReturnValueOnce(false);

    await expect(initWasm()).rejects.toThrow('SQLite WASM module not found');

    existsSpy.mockRestore();
  });

  it('throws when sqlite3 wasm file is missing', async () => {
    vi.resetModules();
    const { initializeSqliteWasm: initWasm } = await import(
      './wasmNode/initializeSqliteWasm'
    );

    const existsSpy = vi.spyOn(fs, 'existsSync');
    existsSpy.mockReturnValueOnce(true).mockReturnValueOnce(false);

    await expect(initWasm()).rejects.toThrow('SQLite WASM binary not found');

    existsSpy.mockRestore();
  });

  it('throws when sqlite3 module export is missing', async () => {
    const modulePath = path.resolve(
      import.meta.dirname,
      '../../workers/sqlite-wasm/sqlite3.js'
    );

    vi.doMock(modulePath, () => ({ default: undefined }));
    vi.resetModules();
    const { initializeSqliteWasm: initWasm } = await import(
      './wasmNode/initializeSqliteWasm'
    );

    const existsSpy = vi.spyOn(fs, 'existsSync');
    existsSpy.mockReturnValue(true);

    await expect(initWasm()).rejects.toThrow(
      'Failed to load sqlite3InitModule from module'
    );

    existsSpy.mockRestore();
    vi.doUnmock(modulePath);
    vi.resetModules();
  });

  it('throws when sqlite3 module is missing required properties', async () => {
    const modulePath = path.resolve(
      import.meta.dirname,
      '../../workers/sqlite-wasm/sqlite3.js'
    );

    vi.doMock(modulePath, () => ({
      default: async () => ({})
    }));
    vi.resetModules();
    const { initializeSqliteWasm: initWasm } = await import(
      './wasmNode/initializeSqliteWasm'
    );

    const existsSpy = vi.spyOn(fs, 'existsSync');
    existsSpy.mockReturnValue(true);

    await expect(initWasm()).rejects.toThrow(
      'SQLite module loaded but missing expected properties'
    );

    existsSpy.mockRestore();
    vi.doUnmock(modulePath);
    vi.resetModules();
  });

  it('wraps errors when opening encrypted databases', async () => {
    const modulePath = path.resolve(
      import.meta.dirname,
      '../../workers/sqlite-wasm/sqlite3.js'
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
    const module = await import('./wasmNode.adapter');

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
      import.meta.dirname,
      '../../workers/sqlite-wasm/sqlite3.js'
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
    const module = await import('./wasmNode.adapter');

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
});
