import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { locateWasmDir, wasmFilesExist } from './locateWasm.js';

const WASM_ENV_VAR = 'TEARLEADS_SQLITE_WASM_DIR';

afterEach(() => {
  delete process.env[WASM_ENV_VAR];
});

describe('locateWasmDir', () => {
  it('prefers explicit env var path when valid', () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'wasm-dir-'));
    const sqliteDir = path.join(tempRoot, 'sqlite-wasm');
    fs.mkdirSync(sqliteDir);
    fs.writeFileSync(path.join(sqliteDir, 'sqlite3.js'), '');
    fs.writeFileSync(path.join(sqliteDir, 'sqlite3.wasm'), '');

    process.env[WASM_ENV_VAR] = sqliteDir;
    const wasmDir = locateWasmDir('/tmp');

    expect(wasmDir).toBe(sqliteDir);
    expect(wasmFilesExist(wasmDir)).toBe(true);

    fs.rmSync(tempRoot, { recursive: true, force: true });
  });

  it('finds WASM directory from current package', () => {
    const wasmDir = locateWasmDir();
    expect(wasmDir.replace(/\\/g, '/')).toMatch(/sqlite-wasm$/);
    expect(wasmFilesExist(wasmDir)).toBe(true);
  });

  it('finds WASM directory from explicit start directory', () => {
    const startDir = path.resolve(__dirname, '../..');
    const wasmDir = locateWasmDir(startDir);
    expect(wasmDir.replace(/\\/g, '/')).toMatch(/sqlite-wasm$/);
  });

  it('throws when WASM files cannot be found', () => {
    expect(() => locateWasmDir('/tmp')).toThrow('SQLite WASM files not found');
  });
});

describe('wasmFilesExist', () => {
  it('returns true for valid WASM directory', () => {
    const wasmDir = locateWasmDir();
    expect(wasmFilesExist(wasmDir)).toBe(true);
  });

  it('returns false for non-existent directory', () => {
    expect(wasmFilesExist('/nonexistent/path')).toBe(false);
  });

  it('returns false for directory without WASM files', () => {
    expect(wasmFilesExist('/tmp')).toBe(false);
  });
});
