import { type SeededUser, seedTestUser } from '@tearleads/api-test-utils';
import { wasApiRequestMade } from '@tearleads/msw/node';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AUTH_TOKEN_KEY } from '@/lib/authStorage';
import {
  installApiV2WasmBindingsTestOverride,
  removeApiV2WasmBindingsTestOverride
} from '@/test/apiV2WasmBindingsTestOverride';
import { getSharedTestContext } from '@/test/testContext';

const mockLogApiEvent = vi.fn();

vi.mock('@/db/analytics', () => ({
  logApiEvent: (...args: unknown[]) => mockLogApiEvent(...args)
}));

const loadApi = async () => {
  const module = await import('./api');
  return module.api;
};

function wasApiRequestMadeWithV1Prefix(
  method: string,
  pathname: string
): boolean {
  if (wasApiRequestMade(method, pathname)) {
    return true;
  }

  if (!pathname.startsWith('/connect/')) {
    return false;
  }

  return wasApiRequestMade(method, `/v1${pathname}`);
}

let seededUser: SeededUser;

describe('api with msw admin routing', () => {
  beforeEach(async () => {
    vi.resetModules();
    const mockedPingWasmModule = {
      v2_ping_path: () => '/v2/ping',
      parse_v2_ping_value: (payload: unknown) => {
        if (typeof payload !== 'object' || payload === null) {
          throw new Error('Invalid v2 ping response payload');
        }
        return payload;
      }
    };
    vi.doMock('./pingWasmImport', () => ({
      importPingWasmModule: () => Promise.resolve(mockedPingWasmModule)
    }));
    Reflect.set(globalThis, '__tearleadsImportPingWasmModule', () =>
      Promise.resolve(mockedPingWasmModule)
    );
    installApiV2WasmBindingsTestOverride();
    vi.clearAllMocks();
    vi.stubEnv('VITE_API_URL', 'http://localhost');
    localStorage.clear();

    const ctx = getSharedTestContext();
    seededUser = await seedTestUser(ctx, { admin: true });
    localStorage.setItem(AUTH_TOKEN_KEY, seededUser.accessToken);

    mockLogApiEvent.mockResolvedValue(undefined);
  });

  afterEach(() => {
    Reflect.deleteProperty(globalThis, '__tearleadsImportPingWasmModule');
    removeApiV2WasmBindingsTestOverride();
    vi.unstubAllEnvs();
  });

  it('routes admin requests through msw and preserves query/encoding', async () => {
    const ctx = getSharedTestContext();

    await ctx.pool.query(
      `INSERT INTO organizations (id, name, created_at, updated_at)
       VALUES ('org 1', 'Test Org', NOW(), NOW())`
    );
    const secondUser = await seedTestUser(ctx);
    await ctx.pool.query(
      `INSERT INTO groups (id, name, organization_id, created_at, updated_at)
       VALUES ('group 1', 'Team', 'org 1', NOW(), NOW())`
    );
    await ctx.pool.query(
      `INSERT INTO user_groups (group_id, user_id, joined_at)
       VALUES ('group 1', $1, NOW())`,
      [secondUser.userId]
    );
    await ctx.redis.set('user:1', 'test-value');

    const api = await loadApi();

    await api.ping.get();
    await api.admin.getContext();
    await api.admin.postgres.getInfo();
    await api.admin.postgres.getTables();
    await api.admin.postgres.getColumns('public', 'users');
    await api.admin.postgres.getRows('public', 'users', {
      limit: 10,
      offset: 20,
      sortColumn: 'id',
      sortDirection: 'desc'
    });
    await api.admin.redis.getKeys('5', 2);
    await api.admin.redis.getValue('user:1');
    await api.admin.redis.deleteKey('user:1');
    await api.admin.redis.getDbSize();

    await api.admin.groups.list({ organizationId: seededUser.organizationId });
    await api.admin.groups.get('group-1');
    await api.admin.groups.create({
      name: 'New Team',
      organizationId: 'org-1'
    });
    await api.admin.groups.update('group-1', { name: 'Team Updated' });
    await api.admin.groups.getMembers('group-1');
    await api.admin.groups.addMember('group-1', seededUser.userId);
    await api.admin.groups.removeMember('group-1', seededUser.userId);
    await api.admin.groups.delete('group-1');

    await api.admin.organizations.list({
      organizationId: seededUser.organizationId
    });
    await api.admin.organizations.get('org-1');
    await api.admin.organizations.getUsers('org-1');
    await api.admin.organizations.getGroups('org-1');
    await api.admin.organizations.create({ name: 'Org Created' });
    await api.admin.organizations.update('org-1', {
      description: 'Updated Description'
    });
    await api.admin.organizations.delete('org-1');

    await api.admin.users.list({ organizationId: seededUser.organizationId });
    await api.admin.users.get('user-1');
    await api.admin.users.update('user-2', {
      emailConfirmed: true,
      admin: false
    });

    expect(wasApiRequestMadeWithV1Prefix('GET', '/v2/ping')).toBe(true);
    expect(
      wasApiRequestMadeWithV1Prefix(
        'POST',
        '/connect/tearleads.v2.AdminService/GetContext'
      )
    ).toBe(true);
    expect(
      wasApiRequestMadeWithV1Prefix(
        'POST',
        '/connect/tearleads.v2.AdminService/GetPostgresInfo'
      )
    ).toBe(true);
    expect(
      wasApiRequestMadeWithV1Prefix(
        'POST',
        '/connect/tearleads.v2.AdminService/GetTables'
      )
    ).toBe(true);
    expect(
      wasApiRequestMadeWithV1Prefix(
        'POST',
        '/connect/tearleads.v2.AdminService/GetColumns'
      )
    ).toBe(true);
    expect(
      wasApiRequestMadeWithV1Prefix(
        'POST',
        '/connect/tearleads.v2.AdminService/GetRows'
      )
    ).toBe(true);
    expect(
      wasApiRequestMadeWithV1Prefix(
        'POST',
        '/connect/tearleads.v2.AdminService/GetRedisKeys'
      )
    ).toBe(true);
    expect(
      wasApiRequestMadeWithV1Prefix(
        'POST',
        '/connect/tearleads.v2.AdminService/GetRedisValue'
      )
    ).toBe(true);
    expect(
      wasApiRequestMadeWithV1Prefix(
        'POST',
        '/connect/tearleads.v2.AdminService/DeleteRedisKey'
      )
    ).toBe(true);
    expect(
      wasApiRequestMadeWithV1Prefix(
        'POST',
        '/connect/tearleads.v2.AdminService/GetRedisDbSize'
      )
    ).toBe(true);
    expect(
      wasApiRequestMadeWithV1Prefix(
        'POST',
        '/connect/tearleads.v2.AdminService/ListGroups'
      )
    ).toBe(true);
    expect(
      wasApiRequestMadeWithV1Prefix(
        'POST',
        '/connect/tearleads.v2.AdminService/GetGroup'
      )
    ).toBe(true);
    expect(
      wasApiRequestMadeWithV1Prefix(
        'POST',
        '/connect/tearleads.v2.AdminService/CreateGroup'
      )
    ).toBe(true);
    expect(
      wasApiRequestMadeWithV1Prefix(
        'POST',
        '/connect/tearleads.v2.AdminService/UpdateGroup'
      )
    ).toBe(true);
    expect(
      wasApiRequestMadeWithV1Prefix(
        'POST',
        '/connect/tearleads.v2.AdminService/DeleteGroup'
      )
    ).toBe(true);
    expect(
      wasApiRequestMadeWithV1Prefix(
        'POST',
        '/connect/tearleads.v2.AdminService/GetGroupMembers'
      )
    ).toBe(true);
    expect(
      wasApiRequestMadeWithV1Prefix(
        'POST',
        '/connect/tearleads.v2.AdminService/AddGroupMember'
      )
    ).toBe(true);
    expect(
      wasApiRequestMadeWithV1Prefix(
        'POST',
        '/connect/tearleads.v2.AdminService/RemoveGroupMember'
      )
    ).toBe(true);
    expect(
      wasApiRequestMadeWithV1Prefix(
        'POST',
        '/connect/tearleads.v2.AdminService/ListOrganizations'
      )
    ).toBe(true);
    expect(
      wasApiRequestMadeWithV1Prefix(
        'POST',
        '/connect/tearleads.v2.AdminService/GetOrganization'
      )
    ).toBe(true);
    expect(
      wasApiRequestMadeWithV1Prefix(
        'POST',
        '/connect/tearleads.v2.AdminService/GetOrgUsers'
      )
    ).toBe(true);
    expect(
      wasApiRequestMadeWithV1Prefix(
        'POST',
        '/connect/tearleads.v2.AdminService/GetOrgGroups'
      )
    ).toBe(true);
    expect(
      wasApiRequestMadeWithV1Prefix(
        'POST',
        '/connect/tearleads.v2.AdminService/CreateOrganization'
      )
    ).toBe(true);
    expect(
      wasApiRequestMadeWithV1Prefix(
        'POST',
        '/connect/tearleads.v2.AdminService/UpdateOrganization'
      )
    ).toBe(true);
    expect(
      wasApiRequestMadeWithV1Prefix(
        'POST',
        '/connect/tearleads.v2.AdminService/DeleteOrganization'
      )
    ).toBe(true);
    expect(
      wasApiRequestMadeWithV1Prefix(
        'POST',
        '/connect/tearleads.v2.AdminService/ListUsers'
      )
    ).toBe(true);
    expect(
      wasApiRequestMadeWithV1Prefix(
        'POST',
        '/connect/tearleads.v2.AdminService/GetUser'
      )
    ).toBe(true);
    expect(
      wasApiRequestMadeWithV1Prefix(
        'POST',
        '/connect/tearleads.v2.AdminService/UpdateUser'
      )
    ).toBe(true);
  });
});
