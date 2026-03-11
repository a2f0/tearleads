import { wasApiRequestMade } from '@tearleads/msw/node';
import { buildAdminV2ConnectMethodPath } from '@tearleads/shared';
import { beforeEach, describe, expect, it } from 'vitest';
import { resetApiCoreRuntimeForTesting } from './apiCore';
import {
  AUTH_TOKEN_KEY,
  resetAuthStorageRuntimeForTesting
} from './authStorage';
import { installApiV2WasmBindingsOverride } from './test/apiV2WasmBindingsTestOverride';
import { setTestEnv } from './test/env.js';

const loadApi = async () => {
  const module = await import('./api');
  return module.api;
};

describe('api adminV2 with msw runtime harness', () => {
  beforeEach(async () => {
    resetAuthStorageRuntimeForTesting();
    setTestEnv('VITE_API_URL', 'http://localhost');
    resetApiCoreRuntimeForTesting();
    localStorage.clear();
    installApiV2WasmBindingsOverride();
    localStorage.setItem(AUTH_TOKEN_KEY, 'Bearer header.payload.signature');
  });

  it('routes wave 1A admin reads through v2 service paths', async () => {
    const api = await loadApi();

    const context = await api.adminV2.getContext();
    const tables = await api.adminV2.postgres.getTables();
    const rows = await api.adminV2.postgres.getRows('public', 'users');
    const redisValue = await api.adminV2.redis.getValue('session:test');
    const redisDbSize = await api.adminV2.redis.getDbSize();

    expect(context.organizations.length).toBeGreaterThan(0);
    expect(tables.tables).toHaveLength(1);
    expect(rows.rows).toHaveLength(1);
    expect(rows.totalCount).toBe(1);
    expect(redisValue.key).toBe('session:test');
    expect(redisDbSize.count).toBe(1);
    expect(
      wasApiRequestMade('POST', buildAdminV2ConnectMethodPath('GetContext'))
    ).toBe(true);
    expect(
      wasApiRequestMade('POST', buildAdminV2ConnectMethodPath('GetTables'))
    ).toBe(true);
    expect(
      wasApiRequestMade('POST', buildAdminV2ConnectMethodPath('GetRows'))
    ).toBe(true);
    expect(
      wasApiRequestMade('POST', buildAdminV2ConnectMethodPath('GetRedisValue'))
    ).toBe(true);
    expect(
      wasApiRequestMade('POST', buildAdminV2ConnectMethodPath('GetRedisDbSize'))
    ).toBe(true);
  });
});
