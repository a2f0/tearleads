import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetApiV2ClientWasmRuntimeForTesting } from './apiV2ClientWasm';

type ApiV2ClientWasmModule = typeof import('./apiV2ClientWasm');

async function loadApiV2ClientWasm(): Promise<ApiV2ClientWasmModule> {
  return import('./apiV2ClientWasm');
}

function mockApiV2WasmImport(importer: (() => Promise<unknown>) | unknown): {
  importMock: ReturnType<typeof vi.fn>;
} {
  const importMock =
    typeof importer === 'function'
      ? vi.fn(importer as () => Promise<unknown>)
      : vi.fn(() => Promise.resolve(importer));
  Reflect.set(globalThis, '__tearleadsImportApiV2ClientWasmModule', importMock);
  return { importMock };
}

function createValidWasmBindings(
  overrides: Partial<{
    default: () => Promise<void>;
    normalizeConnectBaseUrl: (value: string) => string;
    resolveRpcPath: (serviceName: string, methodName: string) => string;
    getProtocolConfig: () => unknown;
    buildRequestHeaders: (
      bearerToken?: string | null,
      organizationId?: string | null
    ) => unknown;
  }> = {}
) {
  return {
    normalizeConnectBaseUrl: (value: string) => `${value}/connect`,
    resolveRpcPath: (serviceName: string, methodName: string) =>
      `/${serviceName}/${methodName}`,
    getProtocolConfig: () => ({
      connectPrefix: '/connect',
      adminServiceName: 'tearleads.v2.AdminService',
      mlsServiceName: 'tearleads.v2.MlsService',
      authorizationHeader: 'authorization',
      organizationHeader: 'x-tearleads-organization-id'
    }),
    buildRequestHeaders: () => ({ headers: {} }),
    ...overrides
  };
}

describe('apiV2ClientWasm', () => {
  beforeEach(() => {
    resetApiV2ClientWasmRuntimeForTesting();
    vi.clearAllMocks();
    Reflect.deleteProperty(
      globalThis,
      '__tearleadsImportApiV2ClientWasmModule'
    );
  });

  afterEach(() => {
    resetApiV2ClientWasmRuntimeForTesting();
    Reflect.deleteProperty(
      globalThis,
      '__tearleadsImportApiV2ClientWasmModule'
    );
  });

  it('initializes wasm once and normalizes connect base URLs', async () => {
    const defaultInit = vi.fn(() => Promise.resolve());
    const { importMock } = mockApiV2WasmImport(
      createValidWasmBindings({ default: defaultInit })
    );

    const { normalizeApiV2ConnectBaseUrl } = await loadApiV2ClientWasm();
    const first = await normalizeApiV2ConnectBaseUrl(
      'https://api.example.test'
    );
    const second = await normalizeApiV2ConnectBaseUrl(
      'https://api.example.test/v2'
    );

    expect(first).toBe('https://api.example.test/connect');
    expect(second).toBe('https://api.example.test/v2/connect');
    expect(defaultInit).toHaveBeenCalledTimes(1);
    expect(importMock).toHaveBeenCalledTimes(1);
  });

  it('uses the global wasm importer hook when configured', async () => {
    const { importMock: globalImportMock } = mockApiV2WasmImport(
      createValidWasmBindings()
    );

    const { normalizeApiV2ConnectBaseUrl } = await loadApiV2ClientWasm();
    await expect(
      normalizeApiV2ConnectBaseUrl('https://api.example.test')
    ).resolves.toBe('https://api.example.test/connect');
    expect(globalImportMock).toHaveBeenCalledTimes(1);
  });

  it('returns canonical admin RPC paths through generic resolver', async () => {
    mockApiV2WasmImport(createValidWasmBindings());

    const { getApiV2AdminRpcPaths } = await loadApiV2ClientWasm();
    await expect(getApiV2AdminRpcPaths()).resolves.toEqual({
      getGroup: '/tearleads.v2.AdminService/GetGroup',
      listOrganizations: '/tearleads.v2.AdminService/ListOrganizations',
      listUsers: '/tearleads.v2.AdminService/ListUsers',
      getPostgresInfo: '/tearleads.v2.AdminService/GetPostgresInfo',
      getTables: '/tearleads.v2.AdminService/GetTables',
      getColumns: '/tearleads.v2.AdminService/GetColumns',
      getRows: '/tearleads.v2.AdminService/GetRows',
      getRedisKeys: '/tearleads.v2.AdminService/GetRedisKeys',
      getRedisValue: '/tearleads.v2.AdminService/GetRedisValue',
      deleteRedisKey: '/tearleads.v2.AdminService/DeleteRedisKey',
      getRedisDbSize: '/tearleads.v2.AdminService/GetRedisDbSize'
    });
  });

  it('returns protocol config from wasm', async () => {
    mockApiV2WasmImport(createValidWasmBindings());

    const { getApiV2ProtocolConfig } = await loadApiV2ClientWasm();
    await expect(getApiV2ProtocolConfig()).resolves.toEqual({
      connectPrefix: '/connect',
      adminServiceName: 'tearleads.v2.AdminService',
      mlsServiceName: 'tearleads.v2.MlsService',
      authorizationHeader: 'authorization',
      organizationHeader: 'x-tearleads-organization-id'
    });
  });

  it('resolves RPC paths and rejects empty service or method names', async () => {
    mockApiV2WasmImport(createValidWasmBindings());

    const { resolveApiV2RpcPath } = await loadApiV2ClientWasm();
    await expect(
      resolveApiV2RpcPath('tearleads.v2.AdminService', 'GetTables')
    ).resolves.toBe('/tearleads.v2.AdminService/GetTables');
    await expect(resolveApiV2RpcPath('   ', 'GetTables')).rejects.toThrow(
      'service name must not be empty'
    );
    await expect(
      resolveApiV2RpcPath('tearleads.v2.AdminService', '  ')
    ).rejects.toThrow('method name must not be empty');
  });

  it('builds auth and organization headers via wasm bindings', async () => {
    const buildRequestHeaders = vi.fn(() => ({
      headers: {
        authorization: 'Bearer token-abc',
        'x-tearleads-organization-id': 'org_123'
      }
    }));

    mockApiV2WasmImport(createValidWasmBindings({ buildRequestHeaders }));

    const { buildApiV2RequestHeaders } = await loadApiV2ClientWasm();
    const headers = await buildApiV2RequestHeaders({
      bearerToken: 'token-abc',
      organizationId: 'org_123'
    });

    expect(buildRequestHeaders).toHaveBeenCalledWith('token-abc', 'org_123');
    expect(headers).toEqual({
      authorization: 'Bearer token-abc',
      'x-tearleads-organization-id': 'org_123'
    });
  });

  it('builds headers when wasm bindings return a map envelope', async () => {
    const buildRequestHeaders = vi.fn(() => ({
      headers: new Map<string, string>([
        ['authorization', 'Bearer token-abc'],
        ['x-tearleads-organization-id', 'org_123']
      ])
    }));

    mockApiV2WasmImport(createValidWasmBindings({ buildRequestHeaders }));

    const { buildApiV2RequestHeaders } = await loadApiV2ClientWasm();
    const headers = await buildApiV2RequestHeaders({
      bearerToken: 'token-abc',
      organizationId: 'org_123'
    });

    expect(headers).toEqual({
      authorization: 'Bearer token-abc',
      'x-tearleads-organization-id': 'org_123'
    });
  });

  it('throws when wasm module shape is invalid', async () => {
    mockApiV2WasmImport({});

    const { normalizeApiV2ConnectBaseUrl } = await loadApiV2ClientWasm();
    await expect(
      normalizeApiV2ConnectBaseUrl('https://api.example.test')
    ).rejects.toThrow('pnpm codegenWasm');
  });

  it('throws when wasm header envelope is invalid', async () => {
    mockApiV2WasmImport(
      createValidWasmBindings({
        buildRequestHeaders: () => ({ headers: { authorization: 123 } })
      })
    );

    const { buildApiV2RequestHeaders } = await loadApiV2ClientWasm();
    await expect(buildApiV2RequestHeaders()).rejects.toThrow(
      'api-v2 wasm header "authorization" must be a string'
    );
  });

  it('throws when wasm protocol config envelope is invalid', async () => {
    mockApiV2WasmImport(
      createValidWasmBindings({ getProtocolConfig: () => ({}) })
    );

    const { getApiV2ProtocolConfig } = await loadApiV2ClientWasm();
    await expect(getApiV2ProtocolConfig()).rejects.toThrow(
      'api-v2 wasm protocol config must include string protocol constants'
    );
  });

  it('retries wasm import after an initialization failure', async () => {
    const failingThenSuccessfulImport = vi
      .fn<() => Promise<unknown>>()
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce(createValidWasmBindings());
    const { importMock } = mockApiV2WasmImport(failingThenSuccessfulImport);

    const { normalizeApiV2ConnectBaseUrl } = await loadApiV2ClientWasm();

    await expect(
      normalizeApiV2ConnectBaseUrl('https://api.example.test')
    ).rejects.toThrow('pnpm codegenWasm');
    await expect(
      normalizeApiV2ConnectBaseUrl('https://api.example.test')
    ).resolves.toBe('https://api.example.test/connect');
    expect(importMock).toHaveBeenCalledTimes(2);
  });
});
