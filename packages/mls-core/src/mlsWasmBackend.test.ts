import { beforeEach, describe, expect, it, vi } from 'vitest';

type MlsWasmBackendModule = typeof import('./mlsWasmBackend');

function mockWasmImport(module: Record<string, unknown>): void {
  vi.doMock('./mlsWasmImport.js', () => ({
    importMlsWasmModule: () => Promise.resolve(module)
  }));
}

async function loadMlsWasmBackend(): Promise<MlsWasmBackendModule> {
  return import('./mlsWasmBackend');
}

describe('mlsWasmBackend', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('returns wasm backend status when module reports ready', async () => {
    mockWasmImport({
      mls_backend_name: () => 'tearleads-mls-core-wasm',
      mls_backend_version: () => '0.1.0',
      mls_backend_ready: () => true,
      mls_backend_notice: () => 'ready'
    });

    const { resolveMlsBackendStatus } = await loadMlsWasmBackend();
    const status = await resolveMlsBackendStatus();

    expect(status.backend).toBe('wasm');
    expect(status.wasmModuleLoaded).toBe(true);
    expect(status.productionReady).toBe(true);
    expect(status.backendName).toBe('tearleads-mls-core-wasm');
  });

  it('returns placeholder status when wasm backend is not ready yet', async () => {
    mockWasmImport({
      mls_backend_name: () => 'tearleads-mls-core-wasm',
      mls_backend_version: () => '0.1.0',
      mls_backend_ready: () => false,
      mls_backend_notice: () => 'not ready'
    });

    const { resolveMlsBackendStatus } = await loadMlsWasmBackend();
    const status = await resolveMlsBackendStatus();

    expect(status.backend).toBe('placeholder');
    expect(status.wasmModuleLoaded).toBe(true);
    expect(status.productionReady).toBe(false);
    expect(status.reason).toContain('not ready');
  });

  it('includes codegen guidance when module shape is invalid', async () => {
    mockWasmImport({});

    const { resolveMlsBackendStatus } = await loadMlsWasmBackend();
    const status = await resolveMlsBackendStatus();

    expect(status.backend).toBe('placeholder');
    expect(status.reason).toContain('pnpm codegenWasm');
  });

  it('falls back to placeholder when import fails', async () => {
    vi.doMock('./mlsWasmImport.js', () => ({
      importMlsWasmModule: () =>
        Promise.reject(new Error('Cannot find WASM module'))
    }));

    const { resolveMlsBackendStatus } = await loadMlsWasmBackend();
    const status = await resolveMlsBackendStatus();

    expect(status.backend).toBe('placeholder');
    expect(status.reason).toContain('Cannot find WASM module');
  });

  it('runs wasm default initializer when present', async () => {
    const defaultInit = vi.fn(() => Promise.resolve());
    mockWasmImport({
      default: defaultInit,
      mls_backend_name: () => 'tearleads-mls-core-wasm',
      mls_backend_version: () => '0.1.0',
      mls_backend_ready: () => false,
      mls_backend_notice: () => 'not ready'
    });

    const { resolveMlsBackendStatus } = await loadMlsWasmBackend();
    await resolveMlsBackendStatus();

    expect(defaultInit).toHaveBeenCalled();
  });
});
