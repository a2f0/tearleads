import { beforeEach, describe, expect, it, vi } from 'vitest';

type PingContractModule = typeof import('./pingContract');

const validPingPayload = {
  status: 'ok',
  service: 'api-v2',
  version: '1.2.3'
} as const;

const wasmModulePath =
  '../.generated/apiV2PingWasm/tearleads_api_v2_ping_wasm.js';

async function loadPingContract(): Promise<PingContractModule> {
  return import('./pingContract');
}

describe('pingContract', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.unmock('../.generated/apiV2PingWasm/tearleads_api_v2_ping_wasm.js');
  });

  it('uses static endpoint when generated wasm bindings are missing', async () => {
    const { getV2PingEndpoint } = await loadPingContract();

    await expect(getV2PingEndpoint()).resolves.toBe('/v2/ping');
  });

  it('falls back to static endpoint when wasm endpoint differs', async () => {
    vi.doMock(wasmModulePath, () => ({
      parse_v2_ping_value: (payload: unknown) => payload,
      v2_ping_path: () => '/v1/ping'
    }));

    const { getV2PingEndpoint } = await loadPingContract();

    await expect(getV2PingEndpoint()).resolves.toBe('/v2/ping');
  });

  it('uses wasm endpoint when it matches the v2 contract path', async () => {
    vi.doMock(wasmModulePath, () => ({
      parse_v2_ping_value: (payload: unknown) => payload,
      v2_ping_path: () => '/v2/ping'
    }));

    const { getV2PingEndpoint } = await loadPingContract();

    await expect(getV2PingEndpoint()).resolves.toBe('/v2/ping');
  });

  it('falls back to static endpoint when wasm endpoint lookup throws', async () => {
    vi.doMock(wasmModulePath, () => ({
      parse_v2_ping_value: (payload: unknown) => payload,
      v2_ping_path: () => {
        throw new Error('endpoint lookup failed');
      }
    }));

    const { getV2PingEndpoint } = await loadPingContract();

    await expect(getV2PingEndpoint()).resolves.toBe('/v2/ping');
  });

  it('returns payload when it already satisfies the contract', async () => {
    const { parseV2PingData } = await loadPingContract();

    await expect(parseV2PingData(validPingPayload)).resolves.toEqual(
      validPingPayload
    );
  });

  it('falls back to TypeScript validation when wasm parse throws', async () => {
    vi.doMock(wasmModulePath, () => ({
      parse_v2_ping_value: () => {
        throw new Error('bad wasm parse');
      },
      v2_ping_path: () => '/v2/ping'
    }));

    const { parseV2PingData } = await loadPingContract();

    await expect(parseV2PingData(validPingPayload)).resolves.toEqual(
      validPingPayload
    );
  });

  it('falls back to payload validation when wasm parser returns invalid payload', async () => {
    vi.doMock(wasmModulePath, () => ({
      parse_v2_ping_value: () => ({
        status: 'ok',
        service: 'api-v1',
        version: ''
      }),
      v2_ping_path: () => '/v2/ping'
    }));

    const { parseV2PingData } = await loadPingContract();

    await expect(parseV2PingData(validPingPayload)).resolves.toEqual(
      validPingPayload
    );
  });

  it('falls back when wasm module shape is invalid', async () => {
    vi.doMock(wasmModulePath, () => ({}));

    const { getV2PingEndpoint, parseV2PingData } = await loadPingContract();

    await expect(getV2PingEndpoint()).resolves.toBe('/v2/ping');
    await expect(parseV2PingData(validPingPayload)).resolves.toEqual(
      validPingPayload
    );
  });

  it('throws for invalid payload when no wasm bindings are available', async () => {
    const { parseV2PingData } = await loadPingContract();

    await expect(
      parseV2PingData({
        status: 'ok',
        service: 'api-v1',
        version: ''
      })
    ).rejects.toThrow('Invalid v2 ping response payload');
  });

  it('rejects invalid payload variants that violate the ping contract', async () => {
    const { parseV2PingData } = await loadPingContract();

    await expect(parseV2PingData(null)).rejects.toThrow(
      'Invalid v2 ping response payload'
    );
    await expect(
      parseV2PingData({
        status: 'error',
        service: 'api-v2',
        version: '1.2.3'
      })
    ).rejects.toThrow('Invalid v2 ping response payload');
    await expect(
      parseV2PingData({
        status: 'ok',
        service: 'api-v1',
        version: '1.2.3'
      })
    ).rejects.toThrow('Invalid v2 ping response payload');
    await expect(
      parseV2PingData({
        status: 'ok',
        service: 'api-v2',
        version: 123
      })
    ).rejects.toThrow('Invalid v2 ping response payload');
    await expect(
      parseV2PingData({
        status: 'ok',
        service: 'api-v2',
        version: '   '
      })
    ).rejects.toThrow('Invalid v2 ping response payload');
  });
});
