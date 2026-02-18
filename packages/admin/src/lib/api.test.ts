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
    await expect(apiClient.admin.redis.deleteKey('k')).resolves.toBeUndefined();

    fetchMock.mockResolvedValueOnce(new Response('', { status: 200 }));
    await expect(apiClient.admin.redis.getDbSize()).resolves.toBeUndefined();
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
        url.includes('/admin/postgres/tables/public/users/columns')
      )
    ).toBe(true);
    expect(
      urls.some((url) => url.includes('/admin/redis/keys?cursor=1&limit=50'))
    ).toBe(true);
    expect(
      urls.some((url) => url.includes('/admin/groups?organizationId=org-1'))
    ).toBe(true);
    expect(
      urls.some((url) =>
        url.includes('/admin/organizations?organizationId=org-1')
      )
    ).toBe(true);
    expect(
      urls.some((url) => url.includes('/admin/users?organizationId=org-1'))
    ).toBe(true);
    expect(
      urls.some((url) =>
        url.includes(
          '/ai/usage?startDate=2024-01-01&endDate=2024-01-31&cursor=2&limit=25'
        )
      )
    ).toBe(true);

    const methods = fetchMock.mock.calls.map(
      ([, init]) => init?.method ?? 'GET'
    );
    expect(methods).toContain('POST');
    expect(methods).toContain('PUT');
    expect(methods).toContain('PATCH');
    expect(methods).toContain('DELETE');
  });
});
