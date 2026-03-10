import { create } from '@bufbuild/protobuf';
import {
  AdminDeleteRedisKeyResponseSchema,
  AdminGetContextResponseSchema,
  AdminGetGroupResponseSchema,
  AdminGetOrganizationResponseSchema,
  AdminGetOrgGroupsResponseSchema,
  AdminGetRedisDbSizeResponseSchema,
  AdminListOrganizationsResponseSchema
} from '@tearleads/shared/gen/tearleads/v2/admin_pb';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' }
  });
}

describe('admin api client', () => {
  const fetchMock = vi.fn<typeof fetch>();
  let apiClient: Awaited<ReturnType<typeof loadApi>>;

  async function loadApi() {
    return (await import('./api')).api;
  }

  beforeEach(async () => {
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

  it('adds auth token when no Authorization header is provided', async () => {
    localStorage.setItem('auth_token', 'token-123');
    fetchMock.mockResolvedValueOnce(jsonResponse({ ok: true }));

    await apiClient.adminV2.getContext();

    const [, requestInit] = fetchMock.mock.calls[0] ?? [];
    const headers = requestInit?.headers;
    expect(headers).toBeInstanceOf(Headers);
    if (!(headers instanceof Headers)) {
      throw new Error('expected Headers instance');
    }
    expect(headers.get('Authorization')).toBe('Bearer token-123');
  });

  it('maps API errors from JSON body or status code', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ error: 'group not found' }, 404)
    );
    await expect(apiClient.adminV2.groups.get('missing')).rejects.toThrow(
      'group not found'
    );

    fetchMock.mockResolvedValueOnce(
      new Response('not-json', {
        status: 500,
        headers: { 'Content-Type': 'text/plain' }
      })
    );
    await expect(apiClient.adminV2.getContext()).rejects.toThrow(
      'API error: 500'
    );
  });

  it('handles empty successful responses', async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }));
    await expect(apiClient.adminV2.redis.deleteKey('k')).resolves.toEqual(
      create(AdminDeleteRedisKeyResponseSchema)
    );

    fetchMock.mockResolvedValueOnce(new Response('', { status: 200 }));
    await expect(apiClient.adminV2.redis.getDbSize()).resolves.toEqual(
      create(AdminGetRedisDbSizeResponseSchema)
    );
  });

  it('decodes admin user responses with generated proto types', async () => {
    const userJson = {
      id: 'user-1',
      email: 'admin@example.com',
      emailConfirmed: true,
      admin: false,
      organizationIds: ['org-1'],
      createdAt: '2024-01-01T12:00:00.000Z',
      disabled: false,
      accounting: {
        totalPromptTokens: '120',
        totalCompletionTokens: '80',
        totalTokens: '200',
        requestCount: '3'
      }
    };

    fetchMock.mockResolvedValueOnce(jsonResponse({ users: [userJson] }));
    const listResponse = await apiClient.adminV2.users.list({
      organizationId: 'org-1'
    });
    expect(listResponse.users).toHaveLength(1);
    expect(listResponse.users[0]?.accounting?.totalTokens).toBe(200n);
    expect(typeof listResponse.users[0]?.accounting?.totalTokens).toBe(
      'bigint'
    );
    expect(listResponse.users[0]?.lastActiveAt).toBeUndefined();
    expect(listResponse.users[0]?.accounting?.lastUsedAt).toBeUndefined();

    fetchMock.mockResolvedValueOnce(jsonResponse({ user: userJson }));
    const getResponse = await apiClient.adminV2.users.get('user-1');
    expect(getResponse.user?.email).toBe('admin@example.com');
    expect(getResponse.user?.accounting?.requestCount).toBe(3n);

    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        user: {
          ...userJson,
          disabled: true,
          disabledAt: '2024-03-01T00:00:00.000Z'
        }
      })
    );
    const updateResponse = await apiClient.adminV2.users.update('user-1', {
      disabled: true
    });
    expect(updateResponse.user?.disabled).toBe(true);
    expect(updateResponse.user?.disabledAt).toBe('2024-03-01T00:00:00.000Z');
  });

  it('decodes admin context, group, and organization responses with generated proto types', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        isRootAdmin: false,
        organizations: [{ id: 'org-1', name: 'Primary Org' }]
      })
    );
    await expect(apiClient.adminV2.getContext()).resolves.toEqual(
      create(AdminGetContextResponseSchema, {
        isRootAdmin: false,
        organizations: [{ id: 'org-1', name: 'Primary Org' }]
      })
    );

    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        group: {
          id: 'group-1',
          organizationId: 'org-1',
          name: 'Core Admin',
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
            createdAt: '2026-01-01T00:00:00Z',
            updatedAt: '2026-01-02T00:00:00Z'
          }
        ]
      })
    );

    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        organization: {
          id: 'org-1',
          name: 'Primary Org',
          description: 'Main org',
          createdAt: '2026-01-01T00:00:00Z',
          updatedAt: '2026-01-02T00:00:00Z'
        }
      })
    );
    const organizationResponse =
      await apiClient.adminV2.organizations.get('org-1');
    expect(organizationResponse).toEqual(
      create(AdminGetOrganizationResponseSchema, {
        organization: {
          id: 'org-1',
          name: 'Primary Org',
          description: 'Main org',
          createdAt: '2026-01-01T00:00:00Z',
          updatedAt: '2026-01-02T00:00:00Z'
        }
      })
    );

    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        groups: [
          {
            id: 'group-1',
            name: 'Ops',
            memberCount: 3
          }
        ]
      })
    );
    await expect(
      apiClient.adminV2.organizations.getGroups('org-1')
    ).resolves.toEqual(
      create(AdminGetOrgGroupsResponseSchema, {
        groups: [
          {
            id: 'group-1',
            name: 'Ops',
            memberCount: 3
          }
        ]
      })
    );
  });

  it('calls all admin endpoint helpers with expected URL shape and method', async () => {
    const calls: Array<() => Promise<unknown>> = [
      () => apiClient.adminV2.getContext(),
      () => apiClient.adminV2.postgres.getInfo(),
      () => apiClient.adminV2.postgres.getTables(),
      () => apiClient.adminV2.postgres.getColumns('public', 'users'),
      () =>
        apiClient.adminV2.postgres.getRows('public', 'users', {
          limit: 10,
          offset: 20,
          sortColumn: 'created_at',
          sortDirection: 'desc'
        }),
      () => apiClient.adminV2.redis.getKeys('1', 50),
      () => apiClient.adminV2.redis.getValue('user:1'),
      () => apiClient.adminV2.redis.deleteKey('user:1'),
      () => apiClient.adminV2.redis.getDbSize(),
      () => apiClient.adminV2.groups.list({ organizationId: 'org-1' }),
      () => apiClient.adminV2.groups.get('group-1'),
      () =>
        apiClient.adminV2.groups.create({
          name: 'Group',
          organizationId: 'org-1',
          description: 'desc'
        }),
      () =>
        apiClient.adminV2.groups.update('group-1', {
          name: 'Updated',
          description: 'new'
        }),
      () => apiClient.adminV2.groups.delete('group-1'),
      () => apiClient.adminV2.groups.getMembers('group-1'),
      () => apiClient.adminV2.groups.addMember('group-1', 'user-1'),
      () => apiClient.adminV2.groups.removeMember('group-1', 'user-1'),
      () => apiClient.adminV2.organizations.list({ organizationId: 'org-1' }),
      () => apiClient.adminV2.organizations.get('org-1'),
      () => apiClient.adminV2.organizations.getUsers('org-1'),
      () => apiClient.adminV2.organizations.getGroups('org-1'),
      () =>
        apiClient.adminV2.organizations.create({
          name: 'Org',
          description: 'desc'
        }),
      () =>
        apiClient.adminV2.organizations.update('org-1', {
          name: 'Org v2',
          description: 'updated'
        }),
      () => apiClient.adminV2.organizations.delete('org-1'),
      () => apiClient.adminV2.users.list({ organizationId: 'org-1' }),
      () => apiClient.adminV2.users.get('user-1'),
      () =>
        apiClient.adminV2.users.update('user-1', {
          email: 'user@example.com',
          admin: true,
          emailConfirmed: true,
          organizationIds: ['org-1'],
          disabled: false,
          markedForDeletion: false
        }),
      () =>
        apiClient.ai.getUsage({
          startDate: '2024-01-01',
          endDate: '2024-01-31',
          cursor: '2',
          limit: 25
        })
    ];

    for (const call of calls) {
      fetchMock.mockResolvedValueOnce(jsonResponse({ ok: true }));
      await call();
    }

    const urls = fetchMock.mock.calls.map(([url]) => String(url));
    expect(
      urls.some((url) =>
        url.includes('/connect/tearleads.v2.AdminService/GetContext')
      )
    ).toBe(true);
    expect(
      urls.some((url) =>
        url.includes('/connect/tearleads.v2.AdminService/GetColumns')
      )
    ).toBe(true);
    expect(
      urls.some((url) =>
        url.includes('/connect/tearleads.v2.AdminService/GetRedisKeys')
      )
    ).toBe(true);
    expect(
      urls.some((url) =>
        url.includes('/connect/tearleads.v2.AdminService/ListGroups')
      )
    ).toBe(true);
    expect(
      urls.some((url) =>
        url.includes('/connect/tearleads.v2.AdminService/GetGroup')
      )
    ).toBe(true);
    expect(
      urls.some((url) =>
        url.includes('/connect/tearleads.v2.AdminService/CreateGroup')
      )
    ).toBe(true);
    expect(
      urls.some((url) =>
        url.includes('/connect/tearleads.v2.AdminService/UpdateGroup')
      )
    ).toBe(true);
    expect(
      urls.some((url) =>
        url.includes('/connect/tearleads.v2.AdminService/DeleteGroup')
      )
    ).toBe(true);
    expect(
      urls.some((url) =>
        url.includes('/connect/tearleads.v2.AdminService/AddGroupMember')
      )
    ).toBe(true);
    expect(
      urls.some((url) =>
        url.includes('/connect/tearleads.v2.AdminService/RemoveGroupMember')
      )
    ).toBe(true);
    expect(
      urls.some((url) =>
        url.includes('/connect/tearleads.v2.AdminService/ListOrganizations')
      )
    ).toBe(true);
    expect(
      urls.some((url) =>
        url.includes('/connect/tearleads.v2.AdminService/GetOrgUsers')
      )
    ).toBe(true);
    expect(
      urls.some((url) =>
        url.includes('/connect/tearleads.v2.AdminService/CreateOrganization')
      )
    ).toBe(true);
    expect(
      urls.some((url) =>
        url.includes('/connect/tearleads.v2.AdminService/UpdateOrganization')
      )
    ).toBe(true);
    expect(
      urls.some((url) =>
        url.includes('/connect/tearleads.v2.AdminService/DeleteOrganization')
      )
    ).toBe(true);
    expect(
      urls.some((url) =>
        url.includes('/connect/tearleads.v2.AdminService/ListUsers')
      )
    ).toBe(true);
    expect(
      urls.some((url) =>
        url.includes('/connect/tearleads.v2.AdminService/UpdateUser')
      )
    ).toBe(true);
    expect(
      urls.some((url) =>
        url.includes('/connect/tearleads.v2.AiService/GetUsage')
      )
    ).toBe(true);
    expect(
      urls.some((url) => url.includes('/connect/tearleads.v1.AdminService/'))
    ).toBe(false);

    const methods = fetchMock.mock.calls.map(
      ([, init]) => init?.method ?? 'GET'
    );
    expect(methods.every((method) => method === 'POST')).toBe(true);
  });
});
