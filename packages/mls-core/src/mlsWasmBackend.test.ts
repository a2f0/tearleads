import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

type MlsWasmModule = Record<string, unknown>;
type ResolveMlsBackendStatus =
  typeof import('./mlsWasmBackend').resolveMlsBackendStatus;
type ResetWasmModulePromiseForTesting =
  typeof import('./mlsWasmBackend').resetWasmModulePromiseForTesting;

const importMlsWasmModuleMock = vi.fn<() => Promise<MlsWasmModule>>();
vi.mock('./mlsWasmImport.js', () => ({
  importMlsWasmModule: () => importMlsWasmModuleMock()
}));

let resolveMlsBackendStatus: ResolveMlsBackendStatus;
let resetWasmModulePromiseForTesting: ResetWasmModulePromiseForTesting;

describe('mlsWasmBackend', () => {
  beforeAll(async () => {
    const module = await import('./mlsWasmBackend');
    resolveMlsBackendStatus = module.resolveMlsBackendStatus;
    resetWasmModulePromiseForTesting = module.resetWasmModulePromiseForTesting;
  });

  beforeEach(() => {
    vi.clearAllMocks();
    resetWasmModulePromiseForTesting();
  });

  it('returns wasm backend status when module reports ready', async () => {
    importMlsWasmModuleMock.mockResolvedValue({
      mls_backend_name: () => 'tearleads-mls-core-wasm',
      mls_backend_version: () => '0.1.0',
      mls_backend_ready: () => true,
      mls_backend_notice: () => 'ready'
    });

    const status = await resolveMlsBackendStatus();

    expect(status.backend).toBe('wasm');
    expect(status.wasmModuleLoaded).toBe(true);
    expect(status.productionReady).toBe(true);
    expect(status.backendName).toBe('tearleads-mls-core-wasm');
  });

  it('returns placeholder status when wasm backend is not ready yet', async () => {
    importMlsWasmModuleMock.mockResolvedValue({
      mls_backend_name: () => 'tearleads-mls-core-wasm',
      mls_backend_version: () => '0.1.0',
      mls_backend_ready: () => false,
      mls_backend_notice: () => 'not ready'
    });

    const status = await resolveMlsBackendStatus();

    expect(status.backend).toBe('placeholder');
    expect(status.wasmModuleLoaded).toBe(true);
    expect(status.productionReady).toBe(false);
    expect(status.reason).toContain('not ready');
  });

  it('includes codegen guidance when module shape is invalid', async () => {
    importMlsWasmModuleMock.mockResolvedValue({});

    const status = await resolveMlsBackendStatus();

    expect(status.backend).toBe('placeholder');
    expect(status.reason).toContain('pnpm codegenWasm');
  });

  it('falls back to placeholder when import fails', async () => {
    importMlsWasmModuleMock.mockRejectedValue(
      new Error('Cannot find WASM module')
    );

    const status = await resolveMlsBackendStatus();

    expect(status.backend).toBe('placeholder');
    expect(status.reason).toContain('Cannot find WASM module');
  });

  it('runs wasm default initializer when present', async () => {
    const defaultInit = vi.fn(() => Promise.resolve(undefined));
    importMlsWasmModuleMock.mockResolvedValue({
      default: defaultInit,
      mls_backend_name: () => 'tearleads-mls-core-wasm',
      mls_backend_version: () => '0.1.0',
      mls_backend_ready: () => false,
      mls_backend_notice: () => 'not ready'
    });

    await resolveMlsBackendStatus();

    expect(defaultInit).toHaveBeenCalled();
  });
});
