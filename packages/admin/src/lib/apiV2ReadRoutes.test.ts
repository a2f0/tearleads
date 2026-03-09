import { create } from '@bufbuild/protobuf';
import {
  AdminGetContextResponseSchema,
  AdminGetGroupResponseSchema,
  AdminListOrganizationsResponseSchema,
  AdminListUsersResponseSchema
} from '@tearleads/shared/gen/tearleads/v2/admin_pb';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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
    vi.resetModules();
    vi.stubEnv('VITE_API_URL', 'https://api.test');
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
    localStorage.clear();
    apiClient = await loadApi();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it('maps v2 postgres and redis payloads to admin DTO shapes', async () => {
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
    await expect(apiClient.adminV2.postgres.getInfo()).resolves.toEqual({
      info: {
        host: 'localhost',
        port: 5432,
        database: 'tearleads',
        user: 'postgres'
      },
      serverVersion: '16.2'
    });

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
    await expect(apiClient.adminV2.postgres.getTables()).resolves.toEqual({
      tables: [
        {
          schema: 'public',
          name: 'users',
          rowCount: 42,
          totalBytes: 2048,
          tableBytes: 1024,
          indexBytes: 1024
        }
      ]
    });

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
    ).resolves.toEqual({
      columns: [
        {
          name: 'email',
          type: 'text',
          nullable: false,
          defaultValue: 'none',
          ordinalPosition: 2
        }
      ]
    });

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
    ).resolves.toEqual({
      rows: [{ id: 'u1' }],
      totalCount: 3,
      limit: 10,
      offset: 20
    });

    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        keys: [{ key: 'session:1', type: 'string', ttl: '60' }],
        cursor: '1',
        hasMore: true
      })
    );
    await expect(apiClient.adminV2.redis.getKeys('1', 10)).resolves.toEqual({
      keys: [{ key: 'session:1', type: 'string', ttl: 60 }],
      cursor: '1',
      hasMore: true
    });

    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        key: 'profile',
        type: 'string',
        ttl: 120,
        value: { stringValue: 'enabled' }
      })
    );
    await expect(apiClient.adminV2.redis.getValue('profile')).resolves.toEqual({
      key: 'profile',
      type: 'string',
      ttl: 120,
      value: 'enabled'
    });

    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        key: 'features',
        type: 'list',
        ttl: '30',
        value: { listValue: { values: ['a', 'b'] } }
      })
    );
    await expect(apiClient.adminV2.redis.getValue('features')).resolves.toEqual(
      {
        key: 'features',
        type: 'list',
        ttl: 30,
        value: ['a', 'b']
      }
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
      {
        key: 'settings',
        type: 'hash',
        ttl: 5,
        value: { mode: 'strict' }
      }
    );

    fetchMock.mockResolvedValueOnce(jsonResponse({ deleted: true }));
    await expect(apiClient.adminV2.redis.deleteKey('k')).resolves.toEqual({
      deleted: true
    });

    fetchMock.mockResolvedValueOnce(jsonResponse({ count: '12' }));
    await expect(apiClient.adminV2.redis.getDbSize()).resolves.toEqual({
      count: 12
    });
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
    await expect(apiClient.adminV2.postgres.getInfo()).resolves.toEqual({
      info: {
        host: null,
        port: null,
        database: null,
        user: null
      },
      serverVersion: null
    });

    fetchMock.mockResolvedValueOnce(jsonResponse({}));
    await expect(apiClient.adminV2.postgres.getTables()).resolves.toEqual({
      tables: []
    });

    fetchMock.mockResolvedValueOnce(jsonResponse({}));
    await expect(
      apiClient.adminV2.postgres.getColumns('', '')
    ).resolves.toEqual({
      columns: []
    });

    fetchMock.mockResolvedValueOnce(jsonResponse({}));
    await expect(
      apiClient.adminV2.postgres.getRows('public', 'users')
    ).resolves.toEqual({
      rows: [],
      totalCount: 0,
      limit: 0,
      offset: 0
    });

    fetchMock.mockResolvedValueOnce(jsonResponse({}));
    await expect(apiClient.adminV2.redis.getKeys()).resolves.toEqual({
      keys: [],
      cursor: '',
      hasMore: false
    });

    fetchMock.mockResolvedValueOnce(jsonResponse({}));
    await expect(apiClient.adminV2.redis.getValue('missing')).resolves.toEqual({
      key: '',
      type: '',
      ttl: 0,
      value: null
    });

    fetchMock.mockResolvedValueOnce(jsonResponse({}));
    await expect(apiClient.adminV2.redis.deleteKey('missing')).resolves.toEqual(
      {
        deleted: false
      }
    );

    fetchMock.mockResolvedValueOnce(jsonResponse({}));
    await expect(apiClient.adminV2.redis.getDbSize()).resolves.toEqual({
      count: 0
    });
  });
});
