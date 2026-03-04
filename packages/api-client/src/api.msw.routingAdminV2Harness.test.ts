import { seedTestUser } from '@tearleads/api-test-utils';
import { wasApiRequestMade } from '@tearleads/msw/node';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AUTH_TOKEN_KEY } from './authStorage';
import { getSharedTestContext } from './test/testContext';

const loadApi = async () => {
  const module = await import('./api');
  return module.api;
};

function installApiV2WasmBindingsOverride(): void {
  Reflect.set(globalThis, '__tearleadsImportApiV2ClientWasmModule', () =>
    Promise.resolve({
      normalizeConnectBaseUrl: (apiBaseUrl: string) => `${apiBaseUrl}/connect`,
      adminGetPostgresInfoPath: () =>
        '/tearleads.v2.AdminService/GetPostgresInfo',
      adminGetTablesPath: () => '/tearleads.v2.AdminService/GetTables',
      adminGetColumnsPath: () => '/tearleads.v2.AdminService/GetColumns',
      adminGetRedisKeysPath: () => '/tearleads.v2.AdminService/GetRedisKeys',
      adminGetRedisValuePath: () => '/tearleads.v2.AdminService/GetRedisValue',
      buildRequestHeaders: (bearerToken?: string | null) => ({
        headers: bearerToken ? { authorization: bearerToken } : {}
      })
    })
  );
}

describe('api adminV2 with msw runtime harness', () => {
  beforeEach(async () => {
    vi.resetModules();
    vi.stubEnv('VITE_API_URL', 'http://localhost');
    localStorage.clear();
    installApiV2WasmBindingsOverride();

    const ctx = getSharedTestContext();
    const seededUser = await seedTestUser(ctx, { admin: true });
    localStorage.setItem(AUTH_TOKEN_KEY, seededUser.accessToken);
  });

  it('routes wave 1A admin reads through v2 service paths', async () => {
    const api = await loadApi();

    const tables = await api.adminV2.postgres.getTables();
    const redisValue = await api.adminV2.redis.getValue('session:test');

    expect(tables.tables).toHaveLength(1);
    expect(redisValue.key).toBe('session:test');
    expect(
      wasApiRequestMade('POST', '/connect/tearleads.v2.AdminService/GetTables')
    ).toBe(true);
    expect(
      wasApiRequestMade(
        'POST',
        '/connect/tearleads.v2.AdminService/GetRedisValue'
      )
    ).toBe(true);
  });
});
