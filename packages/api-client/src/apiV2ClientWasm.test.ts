import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type ApiV2ClientWasmModule = typeof import('./apiV2ClientWasm');

async function loadApiV2ClientWasm(): Promise<ApiV2ClientWasmModule> {
  return import('./apiV2ClientWasm');
}

function mockApiV2WasmImport(module: unknown): {
  importMock: ReturnType<typeof vi.fn>;
} {
  const importMock = vi.fn(() => Promise.resolve(module));
  vi.doMock('./apiV2ClientWasmImport', () => ({
    importApiV2ClientWasmModule: importMock
  }));
  return { importMock };
}

describe('apiV2ClientWasm', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  afterEach(() => {
    Reflect.deleteProperty(
      globalThis,
      '__tearleadsImportApiV2ClientWasmModule'
    );
  });

  it('initializes wasm once and normalizes connect base URLs', async () => {
    const defaultInit = vi.fn(() => Promise.resolve());
    const { importMock } = mockApiV2WasmImport({
      default: defaultInit,
      normalizeConnectBaseUrl: (value: string) => `${value}/connect`,
      adminGetPostgresInfoPath: () =>
        '/tearleads.v2.AdminService/GetPostgresInfo',
      adminGetTablesPath: () => '/tearleads.v2.AdminService/GetTables',
      adminGetColumnsPath: () => '/tearleads.v2.AdminService/GetColumns',
      adminGetRowsPath: () => '/tearleads.v2.AdminService/GetRows',
      adminGetRedisKeysPath: () => '/tearleads.v2.AdminService/GetRedisKeys',
      adminGetRedisValuePath: () => '/tearleads.v2.AdminService/GetRedisValue',
      adminGetRedisDbSizePath: () =>
        '/tearleads.v2.AdminService/GetRedisDbSize',
      buildRequestHeaders: () => ({ headers: {} })
    });

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
    vi.doUnmock('./apiV2ClientWasmImport');
    const globalImportMock = vi.fn(() =>
      Promise.resolve({
        normalizeConnectBaseUrl: (value: string) => `${value}/connect`,
        adminGetPostgresInfoPath: () =>
          '/tearleads.v2.AdminService/GetPostgresInfo',
        adminGetTablesPath: () => '/tearleads.v2.AdminService/GetTables',
        adminGetColumnsPath: () => '/tearleads.v2.AdminService/GetColumns',
        adminGetRowsPath: () => '/tearleads.v2.AdminService/GetRows',
        adminGetRedisKeysPath: () => '/tearleads.v2.AdminService/GetRedisKeys',
        adminGetRedisValuePath: () =>
          '/tearleads.v2.AdminService/GetRedisValue',
        adminGetRedisDbSizePath: () =>
          '/tearleads.v2.AdminService/GetRedisDbSize',
        buildRequestHeaders: () => ({ headers: {} })
      })
    );
    Reflect.set(
      globalThis,
      '__tearleadsImportApiV2ClientWasmModule',
      globalImportMock
    );

    const { normalizeApiV2ConnectBaseUrl } = await loadApiV2ClientWasm();
    await expect(
      normalizeApiV2ConnectBaseUrl('https://api.example.test')
    ).resolves.toBe('https://api.example.test/connect');
    expect(globalImportMock).toHaveBeenCalledTimes(1);
  });

  it('returns canonical admin RPC paths from wasm', async () => {
    mockApiV2WasmImport({
      normalizeConnectBaseUrl: (value: string) => value,
      adminGetPostgresInfoPath: () =>
        '/tearleads.v2.AdminService/GetPostgresInfo',
      adminGetTablesPath: () => '/tearleads.v2.AdminService/GetTables',
      adminGetColumnsPath: () => '/tearleads.v2.AdminService/GetColumns',
      adminGetRowsPath: () => '/tearleads.v2.AdminService/GetRows',
      adminGetRedisKeysPath: () => '/tearleads.v2.AdminService/GetRedisKeys',
      adminGetRedisValuePath: () => '/tearleads.v2.AdminService/GetRedisValue',
      adminGetRedisDbSizePath: () =>
        '/tearleads.v2.AdminService/GetRedisDbSize',
      buildRequestHeaders: () => ({ headers: {} })
    });

    const { getApiV2AdminRpcPaths } = await loadApiV2ClientWasm();
    await expect(getApiV2AdminRpcPaths()).resolves.toEqual({
      getPostgresInfo: '/tearleads.v2.AdminService/GetPostgresInfo',
      getTables: '/tearleads.v2.AdminService/GetTables',
      getColumns: '/tearleads.v2.AdminService/GetColumns',
      getRows: '/tearleads.v2.AdminService/GetRows',
      getRedisKeys: '/tearleads.v2.AdminService/GetRedisKeys',
      getRedisValue: '/tearleads.v2.AdminService/GetRedisValue',
      getRedisDbSize: '/tearleads.v2.AdminService/GetRedisDbSize'
    });
  });

  it('builds auth and organization headers via wasm bindings', async () => {
    const buildRequestHeaders = vi.fn(() => ({
      headers: {
        authorization: 'Bearer token-abc',
        'x-tearleads-organization-id': 'org_123'
      }
    }));

    mockApiV2WasmImport({
      normalizeConnectBaseUrl: (value: string) => value,
      adminGetPostgresInfoPath: () =>
        '/tearleads.v2.AdminService/GetPostgresInfo',
      adminGetTablesPath: () => '/tearleads.v2.AdminService/GetTables',
      adminGetColumnsPath: () => '/tearleads.v2.AdminService/GetColumns',
      adminGetRowsPath: () => '/tearleads.v2.AdminService/GetRows',
      adminGetRedisKeysPath: () => '/tearleads.v2.AdminService/GetRedisKeys',
      adminGetRedisValuePath: () => '/tearleads.v2.AdminService/GetRedisValue',
      adminGetRedisDbSizePath: () =>
        '/tearleads.v2.AdminService/GetRedisDbSize',
      buildRequestHeaders
    });

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

  it('throws when wasm module shape is invalid', async () => {
    mockApiV2WasmImport({});

    const { normalizeApiV2ConnectBaseUrl } = await loadApiV2ClientWasm();
    await expect(
      normalizeApiV2ConnectBaseUrl('https://api.example.test')
    ).rejects.toThrow('pnpm codegenWasm');
  });

  it('throws when wasm header envelope is invalid', async () => {
    mockApiV2WasmImport({
      normalizeConnectBaseUrl: (value: string) => value,
      adminGetPostgresInfoPath: () =>
        '/tearleads.v2.AdminService/GetPostgresInfo',
      adminGetTablesPath: () => '/tearleads.v2.AdminService/GetTables',
      adminGetColumnsPath: () => '/tearleads.v2.AdminService/GetColumns',
      adminGetRowsPath: () => '/tearleads.v2.AdminService/GetRows',
      adminGetRedisKeysPath: () => '/tearleads.v2.AdminService/GetRedisKeys',
      adminGetRedisValuePath: () => '/tearleads.v2.AdminService/GetRedisValue',
      adminGetRedisDbSizePath: () =>
        '/tearleads.v2.AdminService/GetRedisDbSize',
      buildRequestHeaders: () => ({ headers: { authorization: 123 } })
    });

    const { buildApiV2RequestHeaders } = await loadApiV2ClientWasm();
    await expect(buildApiV2RequestHeaders()).rejects.toThrow(
      'api-v2 wasm header "authorization" must be a string'
    );
  });

  it('retries wasm import after an initialization failure', async () => {
    const importMock = vi
      .fn<() => Promise<unknown>>()
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({
        normalizeConnectBaseUrl: (value: string) => `${value}/connect`,
        adminGetPostgresInfoPath: () =>
          '/tearleads.v2.AdminService/GetPostgresInfo',
        adminGetTablesPath: () => '/tearleads.v2.AdminService/GetTables',
        adminGetColumnsPath: () => '/tearleads.v2.AdminService/GetColumns',
        adminGetRowsPath: () => '/tearleads.v2.AdminService/GetRows',
        adminGetRedisKeysPath: () => '/tearleads.v2.AdminService/GetRedisKeys',
        adminGetRedisValuePath: () =>
          '/tearleads.v2.AdminService/GetRedisValue',
        adminGetRedisDbSizePath: () =>
          '/tearleads.v2.AdminService/GetRedisDbSize',
        buildRequestHeaders: () => ({ headers: {} })
      });

    vi.doMock('./apiV2ClientWasmImport', () => ({
      importApiV2ClientWasmModule: importMock
    }));

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
