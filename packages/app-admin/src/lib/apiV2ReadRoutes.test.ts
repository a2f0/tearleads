import { create } from '@bufbuild/protobuf';
import {
  AdminDeleteRedisKeyResponseSchema,
  AdminGetColumnsResponseSchema,
  AdminGetContextResponseSchema,
  AdminGetGroupResponseSchema,
  AdminGetPostgresInfoResponseSchema,
  AdminGetRedisDbSizeResponseSchema,
  AdminGetRedisKeysResponseSchema,
  AdminGetRedisValueResponseSchema,
  AdminGetRowsResponseSchema,
  AdminGetTablesResponseSchema,
  AdminListOrganizationsResponseSchema,
  AdminListUsersResponseSchema
} from '@tearleads/shared/gen/tearleads/v2/admin_pb';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setTestEnv } from './testEnv.js';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' }
  });
}

describe('admin api client v2 read routes', () => {
  const fetchMock = vi.fn<typeof fetch>();
  let apiClient: Awaited<ReturnType<typeof loadApi>>;

  async function loadApi() {
    return (await import('./api')).api;
  }

  beforeEach(async () => {
    setTestEnv('VITE_API_URL', 'https://api.test');
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
    localStorage.clear();
    apiClient = await loadApi();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('decodes remaining postgres and redis responses with generated proto types', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        isRootAdmin: true,
        organizations: [{ id: 'org-1', name: 'Primary Org' }],
        defaultOrganizationId: 'org-1'
      })
    );
    await expect(apiClient.adminV2.getContext()).resolves.toEqual(
      create(AdminGetContextResponseSchema, {
        isRootAdmin: true,
        organizations: [{ id: 'org-1', name: 'Primary Org' }],
        defaultOrganizationId: 'org-1'
      })
    );

    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        group: {
          id: 'group-1',
          organizationId: 'org-1',
          name: 'Core Admin',
          description: 'Operators',
          createdAt: '2026-01-01T00:00:00Z',
          updatedAt: '2026-01-02T00:00:00Z'
        },
        members: [
          {
            userId: 'user-1',
            email: 'admin@example.com',
            joinedAt: '2026-01-01T00:00:00Z'
          }
        ]
      })
    );
    await expect(apiClient.adminV2.groups.get('group-1')).resolves.toEqual(
      create(AdminGetGroupResponseSchema, {
        group: {
          id: 'group-1',
          organizationId: 'org-1',
          name: 'Core Admin',
          description: 'Operators',
          createdAt: '2026-01-01T00:00:00Z',
          updatedAt: '2026-01-02T00:00:00Z'
        },
        members: [
          {
            userId: 'user-1',
            email: 'admin@example.com',
            joinedAt: '2026-01-01T00:00:00Z'
          }
        ]
      })
    );

    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        organizations: [
          {
            id: 'org-1',
            name: 'Primary Org',
            description: 'Main org',
            createdAt: '2026-01-01T00:00:00Z',
            updatedAt: '2026-01-02T00:00:00Z'
          }
        ]
      })
    );
    await expect(
      apiClient.adminV2.organizations.list({ organizationId: 'org-1' })
    ).resolves.toEqual(
      create(AdminListOrganizationsResponseSchema, {
        organizations: [
          {
            id: 'org-1',
            name: 'Primary Org',
            description: 'Main org',
            createdAt: '2026-01-01T00:00:00Z',
            updatedAt: '2026-01-02T00:00:00Z'
          }
        ]
      })
    );

    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        users: [
          {
            id: 'user-1',
            email: 'admin@example.com',
            emailConfirmed: true,
            admin: true,
            organizationIds: ['org-1'],
            createdAt: '2026-01-01T00:00:00Z',
            lastActiveAt: '2026-01-03T00:00:00Z',
            accounting: {
              totalPromptTokens: '10',
              totalCompletionTokens: '20',
              totalTokens: '30',
              requestCount: '3',
              lastUsedAt: '2026-01-03T00:00:00Z'
            },
            disabled: false
          }
        ]
      })
    );
    await expect(
      apiClient.adminV2.users.list({ organizationId: 'org-1' })
    ).resolves.toEqual(
      create(AdminListUsersResponseSchema, {
        users: [
          {
            id: 'user-1',
            email: 'admin@example.com',
            emailConfirmed: true,
            admin: true,
            organizationIds: ['org-1'],
            createdAt: '2026-01-01T00:00:00Z',
            lastActiveAt: '2026-01-03T00:00:00Z',
            accounting: {
              totalPromptTokens: 10n,
              totalCompletionTokens: 20n,
              totalTokens: 30n,
              requestCount: 3n,
              lastUsedAt: '2026-01-03T00:00:00Z'
            },
            disabled: false
          }
        ]
      })
    );

    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        info: {
          host: 'localhost',
          port: 5432,
          database: 'tearleads',
          user: 'postgres'
        },
        serverVersion: '16.2'
      })
    );
    await expect(apiClient.adminV2.postgres.getInfo()).resolves.toEqual(
      create(AdminGetPostgresInfoResponseSchema, {
        info: {
          host: 'localhost',
          port: 5432,
          database: 'tearleads',
          user: 'postgres'
        },
        serverVersion: '16.2'
      })
    );

    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        tables: [
          {
            schema: 'public',
            name: 'users',
            rowCount: '42',
            totalBytes: '2048',
            tableBytes: '1024',
            indexBytes: '1024'
          }
        ]
      })
    );
    await expect(apiClient.adminV2.postgres.getTables()).resolves.toEqual(
      create(AdminGetTablesResponseSchema, {
        tables: [
          {
            schema: 'public',
            name: 'users',
            rowCount: 42n,
            totalBytes: 2048n,
            tableBytes: 1024n,
            indexBytes: 1024n
          }
        ]
      })
    );

    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        columns: [
          {
            name: 'email',
            type: 'text',
            nullable: false,
            defaultValue: 'none',
            ordinalPosition: 2
          }
        ]
      })
    );
    await expect(
      apiClient.adminV2.postgres.getColumns('public', 'users')
    ).resolves.toEqual(
      create(AdminGetColumnsResponseSchema, {
        columns: [
          {
            name: 'email',
            type: 'text',
            nullable: false,
            defaultValue: 'none',
            ordinalPosition: 2
          }
        ]
      })
    );

    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        rows: [{ id: 'u1' }],
        totalCount: '3',
        limit: 10,
        offset: 20
      })
    );
    await expect(
      apiClient.adminV2.postgres.getRows('public', 'users', {
        limit: 10,
        offset: 20
      })
    ).resolves.toEqual(
      create(AdminGetRowsResponseSchema, {
        rows: [{ id: 'u1' }],
        totalCount: 3n,
        limit: 10,
        offset: 20
      })
    );

    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        keys: [{ key: 'session:1', type: 'string', ttl: '60' }],
        cursor: '1',
        hasMore: true
      })
    );
    await expect(apiClient.adminV2.redis.getKeys('1', 10)).resolves.toEqual(
      create(AdminGetRedisKeysResponseSchema, {
        keys: [{ key: 'session:1', type: 'string', ttl: 60n }],
        cursor: '1',
        hasMore: true
      })
    );

    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        key: 'profile',
        type: 'string',
        ttl: 120,
        value: { stringValue: 'enabled' }
      })
    );
    await expect(apiClient.adminV2.redis.getValue('profile')).resolves.toEqual(
      create(AdminGetRedisValueResponseSchema, {
        key: 'profile',
        type: 'string',
        ttl: 120n,
        value: {
          value: {
            case: 'stringValue',
            value: 'enabled'
          }
        }
      })
    );

    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        key: 'features',
        type: 'list',
        ttl: '30',
        value: { listValue: { values: ['a', 'b'] } }
      })
    );
    await expect(apiClient.adminV2.redis.getValue('features')).resolves.toEqual(
      create(AdminGetRedisValueResponseSchema, {
        key: 'features',
        type: 'list',
        ttl: 30n,
        value: {
          value: {
            case: 'listValue',
            value: { values: ['a', 'b'] }
          }
        }
      })
    );

    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        key: 'settings',
        type: 'hash',
        ttl: '5',
        value: { mapValue: { entries: { mode: 'strict' } } }
      })
    );
    await expect(apiClient.adminV2.redis.getValue('settings')).resolves.toEqual(
      create(AdminGetRedisValueResponseSchema, {
        key: 'settings',
        type: 'hash',
        ttl: 5n,
        value: {
          value: {
            case: 'mapValue',
            value: { entries: { mode: 'strict' } }
          }
        }
      })
    );

    fetchMock.mockResolvedValueOnce(jsonResponse({ deleted: true }));
    await expect(apiClient.adminV2.redis.deleteKey('k')).resolves.toEqual(
      create(AdminDeleteRedisKeyResponseSchema, { deleted: true })
    );

    fetchMock.mockResolvedValueOnce(jsonResponse({ count: '12' }));
    await expect(apiClient.adminV2.redis.getDbSize()).resolves.toEqual(
      create(AdminGetRedisDbSizeResponseSchema, { count: 12n })
    );
  });

  it('falls back to safe defaults for incomplete v2 payloads', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({}));
    await expect(apiClient.adminV2.getContext()).resolves.toEqual(
      create(AdminGetContextResponseSchema)
    );

    fetchMock.mockResolvedValueOnce(jsonResponse({}));
    await expect(apiClient.adminV2.groups.get('')).resolves.toEqual(
      create(AdminGetGroupResponseSchema)
    );

    fetchMock.mockResolvedValueOnce(jsonResponse({}));
    await expect(apiClient.adminV2.organizations.list()).resolves.toEqual(
      create(AdminListOrganizationsResponseSchema)
    );

    fetchMock.mockResolvedValueOnce(jsonResponse({}));
    await expect(apiClient.adminV2.users.list()).resolves.toEqual(
      create(AdminListUsersResponseSchema)
    );

    fetchMock.mockResolvedValueOnce(jsonResponse({}));
    await expect(apiClient.adminV2.postgres.getInfo()).resolves.toEqual(
      create(AdminGetPostgresInfoResponseSchema)
    );

    fetchMock.mockResolvedValueOnce(jsonResponse({}));
    await expect(apiClient.adminV2.postgres.getTables()).resolves.toEqual(
      create(AdminGetTablesResponseSchema)
    );

    fetchMock.mockResolvedValueOnce(jsonResponse({}));
    await expect(
      apiClient.adminV2.postgres.getColumns('', '')
    ).resolves.toEqual(create(AdminGetColumnsResponseSchema));

    fetchMock.mockResolvedValueOnce(jsonResponse({}));
    await expect(
      apiClient.adminV2.postgres.getRows('public', 'users')
    ).resolves.toEqual(create(AdminGetRowsResponseSchema));

    fetchMock.mockResolvedValueOnce(jsonResponse({}));
    await expect(apiClient.adminV2.redis.getKeys()).resolves.toEqual(
      create(AdminGetRedisKeysResponseSchema)
    );

    fetchMock.mockResolvedValueOnce(jsonResponse({}));
    await expect(apiClient.adminV2.redis.getValue('missing')).resolves.toEqual(
      create(AdminGetRedisValueResponseSchema)
    );

    fetchMock.mockResolvedValueOnce(jsonResponse({}));
    await expect(apiClient.adminV2.redis.deleteKey('missing')).resolves.toEqual(
      create(AdminDeleteRedisKeyResponseSchema)
    );

    fetchMock.mockResolvedValueOnce(jsonResponse({}));
    await expect(apiClient.adminV2.redis.getDbSize()).resolves.toEqual(
      create(AdminGetRedisDbSizeResponseSchema)
    );
  });
});
