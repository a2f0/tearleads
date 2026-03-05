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

  it('adds auth token when no Authorization header is provided', async () => {
    localStorage.setItem('auth_token', 'token-123');
    fetchMock.mockResolvedValueOnce(jsonResponse({ ok: true }));

    await apiClient.admin.getContext();

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
    await expect(apiClient.admin.groups.get('missing')).rejects.toThrow(
      'group not found'
    );

    fetchMock.mockResolvedValueOnce(
      new Response('not-json', {
        status: 500,
        headers: { 'Content-Type': 'text/plain' }
      })
    );
    await expect(apiClient.admin.getContext()).rejects.toThrow(
      'API error: 500'
    );
  });

  it('handles empty successful responses', async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }));
    await expect(apiClient.admin.redis.deleteKey('k')).resolves.toEqual({
      deleted: false
    });

    fetchMock.mockResolvedValueOnce(new Response('', { status: 200 }));
    await expect(apiClient.admin.redis.getDbSize()).resolves.toEqual({
      count: 0
    });
  });

  it('maps v2 postgres and redis payloads to admin DTO shapes', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        isRootAdmin: true,
        organizations: [{ id: 'org-1', name: 'Primary Org' }],
        defaultOrganizationId: 'org-1'
      })
    );
    await expect(apiClient.admin.getContext()).resolves.toEqual({
      isRootAdmin: true,
      organizations: [{ id: 'org-1', name: 'Primary Org' }],
      defaultOrganizationId: 'org-1'
    });

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
    await expect(apiClient.admin.postgres.getInfo()).resolves.toEqual({
      status: 'ok',
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
    await expect(apiClient.admin.postgres.getTables()).resolves.toEqual({
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
      apiClient.admin.postgres.getColumns('public', 'users')
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
      apiClient.admin.postgres.getRows('public', 'users', {
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
    await expect(apiClient.admin.redis.getKeys('1', 10)).resolves.toEqual({
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
    await expect(apiClient.admin.redis.getValue('profile')).resolves.toEqual({
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
    await expect(apiClient.admin.redis.getValue('features')).resolves.toEqual({
      key: 'features',
      type: 'list',
      ttl: 30,
      value: ['a', 'b']
    });

    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        key: 'settings',
        type: 'hash',
        ttl: '5',
        value: { mapValue: { entries: { mode: 'strict' } } }
      })
    );
    await expect(apiClient.admin.redis.getValue('settings')).resolves.toEqual({
      key: 'settings',
      type: 'hash',
      ttl: 5,
      value: { mode: 'strict' }
    });

    fetchMock.mockResolvedValueOnce(jsonResponse({ deleted: true }));
    await expect(apiClient.admin.redis.deleteKey('k')).resolves.toEqual({
      deleted: true
    });

    fetchMock.mockResolvedValueOnce(jsonResponse({ count: '12' }));
    await expect(apiClient.admin.redis.getDbSize()).resolves.toEqual({
      count: 12
    });
  });

  it('falls back to safe defaults for incomplete v2 payloads', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({}));
    await expect(apiClient.admin.getContext()).resolves.toEqual({
      isRootAdmin: false,
      organizations: [],
      defaultOrganizationId: null
    });

    fetchMock.mockResolvedValueOnce(jsonResponse({}));
    await expect(apiClient.admin.postgres.getInfo()).resolves.toEqual({
      status: 'ok',
      info: {
        host: null,
        port: null,
        database: null,
        user: null
      },
      serverVersion: null
    });

    fetchMock.mockResolvedValueOnce(jsonResponse({}));
    await expect(apiClient.admin.postgres.getTables()).resolves.toEqual({
      tables: []
    });

    fetchMock.mockResolvedValueOnce(jsonResponse({}));
    await expect(apiClient.admin.postgres.getColumns('', '')).resolves.toEqual({
      columns: []
    });

    fetchMock.mockResolvedValueOnce(jsonResponse({}));
    await expect(
      apiClient.admin.postgres.getRows('public', 'users')
    ).resolves.toEqual({
      rows: [],
      totalCount: 0,
      limit: 0,
      offset: 0
    });

    fetchMock.mockResolvedValueOnce(jsonResponse({}));
    await expect(apiClient.admin.redis.getKeys()).resolves.toEqual({
      keys: [],
      cursor: '',
      hasMore: false
    });

    fetchMock.mockResolvedValueOnce(jsonResponse({}));
    await expect(apiClient.admin.redis.getValue('missing')).resolves.toEqual({
      key: '',
      type: '',
      ttl: 0,
      value: null
    });

    fetchMock.mockResolvedValueOnce(jsonResponse({}));
    await expect(apiClient.admin.redis.deleteKey('missing')).resolves.toEqual({
      deleted: false
    });

    fetchMock.mockResolvedValueOnce(jsonResponse({}));
    await expect(apiClient.admin.redis.getDbSize()).resolves.toEqual({
      count: 0
    });
  });

  it('calls all admin endpoint helpers with expected URL shape and method', async () => {
    const calls: Array<() => Promise<unknown>> = [
      () => apiClient.admin.getContext(),
      () => apiClient.admin.postgres.getInfo(),
      () => apiClient.admin.postgres.getTables(),
      () => apiClient.admin.postgres.getColumns('public', 'users'),
      () =>
        apiClient.admin.postgres.getRows('public', 'users', {
          limit: 10,
          offset: 20,
          sortColumn: 'created_at',
          sortDirection: 'desc'
        }),
      () => apiClient.admin.redis.getKeys('1', 50),
      () => apiClient.admin.redis.getValue('user:1'),
      () => apiClient.admin.redis.deleteKey('user:1'),
      () => apiClient.admin.redis.getDbSize(),
      () => apiClient.admin.groups.list({ organizationId: 'org-1' }),
      () => apiClient.admin.groups.get('group-1'),
      () =>
        apiClient.admin.groups.create({
          name: 'Group',
          organizationId: 'org-1',
          description: 'desc'
        }),
      () =>
        apiClient.admin.groups.update('group-1', {
          name: 'Updated',
          description: 'new'
        }),
      () => apiClient.admin.groups.delete('group-1'),
      () => apiClient.admin.groups.getMembers('group-1'),
      () => apiClient.admin.groups.addMember('group-1', 'user-1'),
      () => apiClient.admin.groups.removeMember('group-1', 'user-1'),
      () => apiClient.admin.organizations.list({ organizationId: 'org-1' }),
      () => apiClient.admin.organizations.get('org-1'),
      () => apiClient.admin.organizations.getUsers('org-1'),
      () => apiClient.admin.organizations.getGroups('org-1'),
      () =>
        apiClient.admin.organizations.create({
          name: 'Org',
          description: 'desc'
        }),
      () =>
        apiClient.admin.organizations.update('org-1', {
          name: 'Org v2',
          description: 'updated'
        }),
      () => apiClient.admin.organizations.delete('org-1'),
      () => apiClient.admin.users.list({ organizationId: 'org-1' }),
      () => apiClient.admin.users.get('user-1'),
      () =>
        apiClient.admin.users.update('user-1', {
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
        url.includes('/connect/tearleads.v1.AdminService/ListOrganizations')
      )
    ).toBe(true);
    expect(
      urls.some((url) =>
        url.includes('/connect/tearleads.v1.AdminService/ListUsers')
      )
    ).toBe(true);
    expect(
      urls.some((url) =>
        url.includes('/connect/tearleads.v1.AiService/GetUsage')
      )
    ).toBe(true);

    const methods = fetchMock.mock.calls.map(
      ([, init]) => init?.method ?? 'GET'
    );
    expect(methods.every((method) => method === 'POST')).toBe(true);
  });
});
