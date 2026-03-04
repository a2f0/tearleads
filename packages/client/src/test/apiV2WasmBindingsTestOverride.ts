const GLOBAL_API_V2_CLIENT_WASM_IMPORTER_KEY =
  '__tearleadsImportApiV2ClientWasmModule';

const mockedApiV2ClientWasmModule = {
  normalizeConnectBaseUrl: (apiBaseUrl: string) => `${apiBaseUrl}/connect`,
  adminGetPostgresInfoPath: () => '/tearleads.v2.AdminService/GetPostgresInfo',
  adminGetTablesPath: () => '/tearleads.v2.AdminService/GetTables',
  adminGetColumnsPath: () => '/tearleads.v2.AdminService/GetColumns',
  adminGetRowsPath: () => '/tearleads.v2.AdminService/GetRows',
  adminGetRedisKeysPath: () => '/tearleads.v2.AdminService/GetRedisKeys',
  adminGetRedisValuePath: () => '/tearleads.v2.AdminService/GetRedisValue',
  adminDeleteRedisKeyPath: () => '/tearleads.v2.AdminService/DeleteRedisKey',
  adminGetRedisDbSizePath: () => '/tearleads.v2.AdminService/GetRedisDbSize',
  buildRequestHeaders: (
    bearerToken?: string | null,
    organizationId?: string | null
  ) => {
    const headers: Record<string, string> = {};
    if (typeof bearerToken === 'string' && bearerToken.length > 0) {
      headers['authorization'] = bearerToken;
    }
    if (typeof organizationId === 'string' && organizationId.length > 0) {
      headers['x-organization-id'] = organizationId;
    }
    return { headers };
  }
};

export function installApiV2WasmBindingsTestOverride(): void {
  Reflect.set(globalThis, GLOBAL_API_V2_CLIENT_WASM_IMPORTER_KEY, () =>
    Promise.resolve(mockedApiV2ClientWasmModule)
  );
}

export function removeApiV2WasmBindingsTestOverride(): void {
  Reflect.deleteProperty(globalThis, GLOBAL_API_V2_CLIENT_WASM_IMPORTER_KEY);
}
