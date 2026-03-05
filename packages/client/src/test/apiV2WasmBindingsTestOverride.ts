const GLOBAL_API_V2_CLIENT_WASM_IMPORTER_KEY =
  '__tearleadsImportApiV2ClientWasmModule';

const mockedApiV2ClientWasmModule = {
  normalizeConnectBaseUrl: (apiBaseUrl: string) => `${apiBaseUrl}/connect`,
  resolveRpcPath: (serviceName: string, methodName: string) =>
    `/${serviceName}/${methodName}`,
  getProtocolConfig: () => ({
    connectPrefix: '/connect',
    adminServiceName: 'tearleads.v2.AdminService',
    mlsServiceName: 'tearleads.v2.MlsService',
    authorizationHeader: 'authorization',
    organizationHeader: 'x-tearleads-organization-id'
  }),
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
