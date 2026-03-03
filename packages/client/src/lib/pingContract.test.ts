import { beforeEach, describe, expect, it, vi } from 'vitest';

type PingContractModule = typeof import('./pingContract');

const validPingPayload = {
  status: 'ok',
  service: 'api-v2',
  version: '1.2.3'
} as const;

async function loadPingContract(): Promise<PingContractModule> {
  return import('./pingContract');
}

function mockWasmImport(module: Record<string, unknown>): void {
  vi.doMock('./pingWasmImport', () => ({
    importPingWasmModule: () => Promise.resolve(module)
  }));
}

describe('pingContract', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('returns WASM endpoint path directly', async () => {
    mockWasmImport({
      parse_v2_ping_value: (payload: unknown) => payload,
      v2_ping_path: () => '/v2/ping'
    });

    const { getV2PingEndpoint } = await loadPingContract();

    await expect(getV2PingEndpoint()).resolves.toBe('/v2/ping');
  });

  it('returns WASM-parsed payload directly', async () => {
    mockWasmImport({
      parse_v2_ping_value: () => validPingPayload,
      v2_ping_path: () => '/v2/ping'
    });

    const { parseV2PingData } = await loadPingContract();

    await expect(parseV2PingData(validPingPayload)).resolves.toEqual(
      validPingPayload
    );
  });

  it('propagates WASM parse errors', async () => {
    mockWasmImport({
      parse_v2_ping_value: () => {
        throw new Error('bad wasm parse');
      },
      v2_ping_path: () => '/v2/ping'
    });

    const { parseV2PingData } = await loadPingContract();

    await expect(parseV2PingData(validPingPayload)).rejects.toThrow(
      'bad wasm parse'
    );
  });

  it('propagates WASM endpoint errors', async () => {
    mockWasmImport({
      parse_v2_ping_value: (payload: unknown) => payload,
      v2_ping_path: () => {
        throw new Error('endpoint lookup failed');
      }
    });

    const { getV2PingEndpoint } = await loadPingContract();

    await expect(getV2PingEndpoint()).rejects.toThrow('endpoint lookup failed');
  });

  it('falls back when WASM module is missing', async () => {
    vi.doMock('./pingWasmImport', () => ({
      importPingWasmModule: () =>
        Promise.reject(
          Object.assign(new Error('Cannot find module'), {
            code: 'ERR_MODULE_NOT_FOUND'
          })
        )
    }));

    const { getV2PingEndpoint, parseV2PingData } = await loadPingContract();

    await expect(getV2PingEndpoint()).resolves.toBe('/v2/ping');
    await expect(parseV2PingData(validPingPayload)).resolves.toEqual(
      validPingPayload
    );
  });

  it('throws with helpful message when WASM module shape is invalid', async () => {
    mockWasmImport({});

    const { getV2PingEndpoint } = await loadPingContract();

    await expect(getV2PingEndpoint()).rejects.toThrow('pnpm codegenWasm');
  });

  it('calls default() initializer when present', async () => {
    const defaultInit = vi.fn(() => Promise.resolve());
    mockWasmImport({
      default: defaultInit,
      parse_v2_ping_value: (payload: unknown) => payload,
      v2_ping_path: () => '/v2/ping'
    });

    const { getV2PingEndpoint } = await loadPingContract();

    await getV2PingEndpoint();
    expect(defaultInit).toHaveBeenCalled();
  });
});
