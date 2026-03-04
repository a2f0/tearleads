const GLOBAL_API_V2_CLIENT_WASM_IMPORTER_KEY =
  '__tearleadsImportApiV2ClientWasmModule';

const mockedApiV2ClientWasmModule = {
  normalizeConnectBaseUrl: (apiBaseUrl: string) => `${apiBaseUrl}/connect`,
  adminGetPostgresInfoPath: () => '/tearleads.v2.AdminService/GetPostgresInfo',
  adminGetTablesPath: () => '/tearleads.v2.AdminService/GetTables',
  adminGetColumnsPath: () => '/tearleads.v2.AdminService/GetColumns',
  adminGetRedisKeysPath: () => '/tearleads.v2.AdminService/GetRedisKeys',
  adminGetRedisValuePath: () => '/tearleads.v2.AdminService/GetRedisValue',
  buildRequestHeaders: (bearerToken?: string | null) => {
    const headers: Record<string, string> = {};
    if (typeof bearerToken === 'string' && bearerToken.length > 0) {
      headers.authorization = bearerToken;
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
