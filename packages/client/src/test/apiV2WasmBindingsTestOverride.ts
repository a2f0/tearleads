const GLOBAL_API_V2_CLIENT_WASM_IMPORTER_KEY =
  '__tearleadsImportApiV2ClientWasmModule';

const normalizeConnectBaseUrl = (apiBaseUrl: string): string => {
  const trimmed = apiBaseUrl.trim();
  const normalizedBaseUrl = trimmed.replace(/\/+$/u, '');
  if (normalizedBaseUrl.length === 0) {
    return '/connect';
  }
  if (normalizedBaseUrl.endsWith('/connect')) {
    return normalizedBaseUrl;
  }
  return `${normalizedBaseUrl}/connect`;
};

const normalizeBearerToken = (bearerToken?: string | null): string | null => {
  if (typeof bearerToken !== 'string') {
    return null;
  }

  const trimmed = bearerToken.trim();
  if (trimmed.length === 0) {
    return null;
  }

  if (/^Bearer\s+/i.test(trimmed)) {
    return trimmed;
  }

  return `Bearer ${trimmed}`;
};

const mockedApiV2ClientWasmModule = {
  normalizeConnectBaseUrl,
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
    const normalizedBearerToken = normalizeBearerToken(bearerToken);
    if (normalizedBearerToken !== null) {
      headers['authorization'] = normalizedBearerToken;
    }
    if (
      typeof organizationId === 'string' &&
      organizationId.trim().length > 0
    ) {
      headers['x-tearleads-organization-id'] = organizationId.trim();
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
