export function installApiV2WasmBindingsOverride(): void {
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

  Reflect.set(globalThis, '__tearleadsImportApiV2ClientWasmModule', () =>
    Promise.resolve({
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
