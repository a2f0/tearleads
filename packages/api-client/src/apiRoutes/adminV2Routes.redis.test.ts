import { describe, expect, it, vi } from 'vitest';
import { type AdminV2Client, createAdminV2Routes } from './adminV2Routes';

interface AdminV2ClientOverrides {
  getContext?: AdminV2Client['getContext'];
  listGroups?: AdminV2Client['listGroups'];
  getGroup?: AdminV2Client['getGroup'];
  createGroup?: AdminV2Client['createGroup'];
  updateGroup?: AdminV2Client['updateGroup'];
  deleteGroup?: AdminV2Client['deleteGroup'];
  getGroupMembers?: AdminV2Client['getGroupMembers'];
  addGroupMember?: AdminV2Client['addGroupMember'];
  removeGroupMember?: AdminV2Client['removeGroupMember'];
  listOrganizations?: AdminV2Client['listOrganizations'];
  getOrganization?: AdminV2Client['getOrganization'];
  getOrgUsers?: AdminV2Client['getOrgUsers'];
  getOrgGroups?: AdminV2Client['getOrgGroups'];
  createOrganization?: AdminV2Client['createOrganization'];
  updateOrganization?: AdminV2Client['updateOrganization'];
  deleteOrganization?: AdminV2Client['deleteOrganization'];
  listUsers?: AdminV2Client['listUsers'];
  getUser?: AdminV2Client['getUser'];
  updateUser?: AdminV2Client['updateUser'];
  getPostgresInfo?: AdminV2Client['getPostgresInfo'];
  getTables?: AdminV2Client['getTables'];
  getColumns?: AdminV2Client['getColumns'];
  getRows?: AdminV2Client['getRows'];
  getRedisKeys?: AdminV2Client['getRedisKeys'];
  getRedisValue?: AdminV2Client['getRedisValue'];
  deleteRedisKey?: AdminV2Client['deleteRedisKey'];
  getRedisDbSize?: AdminV2Client['getRedisDbSize'];
}

function createAdminV2ClientStub(
  overrides: AdminV2ClientOverrides = {}
): AdminV2Client {
  return {
    getContext:
      overrides.getContext ??
      vi.fn(async () => ({
        isRootAdmin: false,
        organizations: [],
        defaultOrganizationId: undefined
      })),
    listGroups: overrides.listGroups ?? vi.fn(async () => ({ groups: [] })),
    getGroup:
      overrides.getGroup ??
      vi.fn(async () => ({ group: undefined, members: [] })),
    createGroup:
      overrides.createGroup ?? vi.fn(async () => ({ group: undefined })),
    updateGroup:
      overrides.updateGroup ?? vi.fn(async () => ({ group: undefined })),
    deleteGroup:
      overrides.deleteGroup ?? vi.fn(async () => ({ deleted: false })),
    getGroupMembers:
      overrides.getGroupMembers ?? vi.fn(async () => ({ members: [] })),
    addGroupMember:
      overrides.addGroupMember ?? vi.fn(async () => ({ added: false })),
    removeGroupMember:
      overrides.removeGroupMember ?? vi.fn(async () => ({ removed: false })),
    listOrganizations:
      overrides.listOrganizations ?? vi.fn(async () => ({ organizations: [] })),
    getOrganization:
      overrides.getOrganization ??
      vi.fn(async () => ({ organization: undefined })),
    getOrgUsers: overrides.getOrgUsers ?? vi.fn(async () => ({ users: [] })),
    getOrgGroups: overrides.getOrgGroups ?? vi.fn(async () => ({ groups: [] })),
    createOrganization:
      overrides.createOrganization ??
      vi.fn(async () => ({ organization: undefined })),
    updateOrganization:
      overrides.updateOrganization ??
      vi.fn(async () => ({ organization: undefined })),
    deleteOrganization:
      overrides.deleteOrganization ?? vi.fn(async () => ({ deleted: false })),
    listUsers: overrides.listUsers ?? vi.fn(async () => ({ users: [] })),
    getUser: overrides.getUser ?? vi.fn(async () => ({ user: undefined })),
    updateUser:
      overrides.updateUser ?? vi.fn(async () => ({ user: undefined })),
    getPostgresInfo:
      overrides.getPostgresInfo ??
      vi.fn(async () => ({ info: undefined, serverVersion: undefined })),
    getTables: overrides.getTables ?? vi.fn(async () => ({ tables: [] })),
    getColumns: overrides.getColumns ?? vi.fn(async () => ({ columns: [] })),
    getRows:
      overrides.getRows ??
      vi.fn(async () => ({
        rows: [],
        totalCount: 0n,
        limit: 0,
        offset: 0
      })),
    getRedisKeys:
      overrides.getRedisKeys ??
      vi.fn(async () => ({ keys: [], cursor: '0', hasMore: false })),
    getRedisValue:
      overrides.getRedisValue ??
      vi.fn(async () => ({ key: '', type: '', ttl: 0n, value: undefined })),
    deleteRedisKey:
      overrides.deleteRedisKey ?? vi.fn(async () => ({ deleted: false })),
    getRedisDbSize:
      overrides.getRedisDbSize ?? vi.fn(async () => ({ count: 0n }))
  };
}

function createRoutesForTest(
  client: AdminV2Client,
  logEvent = vi.fn(async () => undefined),
  buildHeaders = vi.fn(async () => ({ authorization: 'Bearer token-123' }))
) {
  const routes = createAdminV2Routes({
    resolveApiBaseUrl: () => 'https://api.example.test',
    normalizeConnectBaseUrl: async (apiBaseUrl) => `${apiBaseUrl}/connect`,
    buildHeaders,
    getAuthHeaderValue: () => 'Bearer token-123',
    createClient: () => client,
    logEvent
  });

  return {
    routes,
    logEvent,
    buildHeaders
  };
}

describe('adminV2Routes redis mappings', () => {
  it('maps redis key/value/delete/dbsize responses and forwards request args', async () => {
    const getRedisKeys = vi.fn(async () => ({
      keys: [{ key: 'session:1', type: 'string', ttl: 120n }],
      cursor: '8',
      hasMore: true
    }));
    const getRedisValue = vi.fn(async () => ({
      key: 'config',
      type: 'hash',
      ttl: 10n,
      value: {
        value: {
          case: 'mapValue',
          value: {
            entries: { mode: 'strict' }
          }
        }
      }
    }));
    const deleteRedisKey = vi.fn(async () => ({ deleted: true }));
    const getRedisDbSize = vi.fn(async () => ({ count: 12n }));
    const client = createAdminV2ClientStub({
      getRedisKeys,
      getRedisValue,
      deleteRedisKey,
      getRedisDbSize
    });
    const { routes, logEvent, buildHeaders } = createRoutesForTest(client);

    const keysResponse = await routes.redis.getKeys('5', 10);
    const valueResponse = await routes.redis.getValue('config');
    const deleteResponse = await routes.redis.deleteKey('config');
    const dbSizeResponse = await routes.redis.getDbSize();

    expect(keysResponse).toEqual({
      keys: [{ key: 'session:1', type: 'string', ttl: 120 }],
      cursor: '8',
      hasMore: true
    });
    expect(valueResponse).toEqual({
      key: 'config',
      type: 'hash',
      ttl: 10,
      value: { mode: 'strict' }
    });
    expect(deleteResponse).toEqual({ deleted: true });
    expect(dbSizeResponse).toEqual({ count: 12 });
    expect(getRedisKeys.mock.calls[0]?.[0].cursor).toBe('5');
    expect(getRedisKeys.mock.calls[0]?.[0].limit).toBe(10);
    expect(getRedisValue.mock.calls[0]?.[0].key).toBe('config');
    expect(deleteRedisKey.mock.calls[0]?.[0].key).toBe('config');
    expect(buildHeaders).toHaveBeenCalledTimes(4);
    expect(logEvent).toHaveBeenCalledWith(
      'api_get_admin_redis_keys',
      expect.any(Number),
      true
    );
    expect(logEvent).toHaveBeenCalledWith(
      'api_get_admin_redis_key',
      expect.any(Number),
      true
    );
    expect(logEvent).toHaveBeenCalledWith(
      'api_delete_admin_redis_key',
      expect.any(Number),
      true
    );
    expect(logEvent).toHaveBeenCalledWith(
      'api_get_admin_redis_dbsize',
      expect.any(Number),
      true
    );
  });

  it('maps redis string and list value variants', async () => {
    const getRedisValue = vi
      .fn()
      .mockResolvedValueOnce({
        key: 'feature:flag',
        type: 'string',
        ttl: 60n,
        value: {
          value: {
            case: 'stringValue',
            value: 'enabled'
          }
        }
      })
      .mockResolvedValueOnce({
        key: 'jobs:queue',
        type: 'list',
        ttl: 30n,
        value: {
          value: {
            case: 'listValue',
            value: {
              values: ['job-1', 'job-2']
            }
          }
        }
      });
    const client = createAdminV2ClientStub({ getRedisValue });
    const { routes, logEvent } = createRoutesForTest(client);

    const stringResponse = await routes.redis.getValue('feature:flag');
    const listResponse = await routes.redis.getValue('jobs:queue');

    expect(stringResponse).toEqual({
      key: 'feature:flag',
      type: 'string',
      ttl: 60,
      value: 'enabled'
    });
    expect(listResponse).toEqual({
      key: 'jobs:queue',
      type: 'list',
      ttl: 30,
      value: ['job-1', 'job-2']
    });
    expect(logEvent).toHaveBeenCalledWith(
      'api_get_admin_redis_key',
      expect.any(Number),
      true
    );
  });
});
