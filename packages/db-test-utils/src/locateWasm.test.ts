import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { locateWasmDir, wasmFilesExist } from './locateWasm.js';

describe('locateWasmDir', () => {
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
