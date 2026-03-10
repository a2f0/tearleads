import { wasApiRequestMade } from '@tearleads/msw/node';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AUTH_TOKEN_KEY } from './authStorage';
import { installApiV2WasmBindingsOverride } from './test/apiV2WasmBindingsTestOverride';
import { setTestEnv } from './test/env.js';

const loadApi = async () => {
  const module = await import('./api');
  return module.api;
};

describe('api adminV2 with msw runtime harness', () => {
  beforeEach(async () => {
    vi.resetModules();
    setTestEnv('VITE_API_URL', 'http://localhost');
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
      wasApiRequestMade('POST', '/connect/tearleads.v2.AdminService/GetContext')
    ).toBe(true);
    expect(
      wasApiRequestMade('POST', '/connect/tearleads.v2.AdminService/GetTables')
    ).toBe(true);
    expect(
      wasApiRequestMade('POST', '/connect/tearleads.v2.AdminService/GetRows')
    ).toBe(true);
    expect(
      wasApiRequestMade(
        'POST',
        '/connect/tearleads.v2.AdminService/GetRedisValue'
      )
    ).toBe(true);
    expect(
      wasApiRequestMade(
        'POST',
        '/connect/tearleads.v2.AdminService/GetRedisDbSize'
      )
    ).toBe(true);
  });
});
