export function installApiV2WasmBindingsOverride(): void {
  const normalizeBearerToken = (bearerToken?: string | null): string | null => {
    if (typeof bearerToken !== 'string' || bearerToken.length === 0) {
      return null;
    }

    return /^Bearer\s+\S+\.\S+\.\S+$/.test(bearerToken)
      ? bearerToken
      : 'Bearer header.payload.signature';
  };

  Reflect.set(globalThis, '__tearleadsImportApiV2ClientWasmModule', () =>
    Promise.resolve({
      normalizeConnectBaseUrl: (apiBaseUrl: string) => `${apiBaseUrl}/connect`,
      adminGetPostgresInfoPath: () =>
        '/tearleads.v2.AdminService/GetPostgresInfo',
      adminGetTablesPath: () => '/tearleads.v2.AdminService/GetTables',
      adminGetColumnsPath: () => '/tearleads.v2.AdminService/GetColumns',
      adminGetRowsPath: () => '/tearleads.v2.AdminService/GetRows',
      adminGetRedisKeysPath: () => '/tearleads.v2.AdminService/GetRedisKeys',
      adminGetRedisValuePath: () => '/tearleads.v2.AdminService/GetRedisValue',
      adminGetRedisDbSizePath: () =>
        '/tearleads.v2.AdminService/GetRedisDbSize',
      buildRequestHeaders: (bearerToken?: string | null) => {
        const normalizedBearerToken = normalizeBearerToken(bearerToken);
        return {
          headers: normalizedBearerToken
            ? { authorization: normalizedBearerToken }
            : {}
        };
      }
    })
  );
}
