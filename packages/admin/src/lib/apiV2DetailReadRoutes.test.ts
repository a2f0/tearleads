import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' }
  });
}

describe('admin api client v2 detail read routes', () => {
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

  it('maps v2 detail read payloads to admin DTOs', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        members: [
          {
            userId: 'user-1',
            email: 'admin@example.com',
            joinedAt: '2026-01-01T00:00:00Z'
          }
        ]
      })
    );
    await expect(apiClient.admin.groups.getMembers('group-1')).resolves.toEqual(
      {
        members: [
          {
            userId: 'user-1',
            email: 'admin@example.com',
            joinedAt: '2026-01-01T00:00:00Z'
          }
        ]
      }
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
    await expect(apiClient.admin.organizations.get('org-1')).resolves.toEqual({
      organization: {
        id: 'org-1',
        name: 'Primary Org',
        description: 'Main org',
        createdAt: '2026-01-01T00:00:00Z',
        updatedAt: '2026-01-02T00:00:00Z'
      }
    });

    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        users: [
          {
            id: 'user-1',
            email: 'admin@example.com',
            joinedAt: '2026-01-01T00:00:00Z'
          }
        ]
      })
    );
    await expect(
      apiClient.admin.organizations.getUsers('org-1')
    ).resolves.toEqual({
      users: [
        {
          id: 'user-1',
          email: 'admin@example.com',
          joinedAt: '2026-01-01T00:00:00Z'
        }
      ]
    });

    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        groups: [
          {
            id: 'group-1',
            name: 'Ops',
            description: 'Operators',
            memberCount: '3'
          }
        ]
      })
    );
    await expect(
      apiClient.admin.organizations.getGroups('org-1')
    ).resolves.toEqual({
      groups: [
        {
          id: 'group-1',
          name: 'Ops',
          description: 'Operators',
          memberCount: 3
        }
      ]
    });

    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        user: {
          id: 'user-1',
          email: 'admin@example.com',
          emailConfirmed: true,
          admin: true,
          organizationIds: ['org-1'],
          createdAt: '2026-01-01T00:00:00Z',
          lastActiveAt: '2026-01-02T00:00:00Z',
          accounting: {
            totalPromptTokens: '10',
            totalCompletionTokens: '20',
            totalTokens: '30',
            requestCount: '4',
            lastUsedAt: '2026-01-03T00:00:00Z'
          },
          disabled: false
        }
      })
    );
    await expect(apiClient.admin.users.get('user-1')).resolves.toEqual({
      user: {
        id: 'user-1',
        email: 'admin@example.com',
        emailConfirmed: true,
        admin: true,
        organizationIds: ['org-1'],
        createdAt: '2026-01-01T00:00:00Z',
        lastActiveAt: '2026-01-02T00:00:00Z',
        accounting: {
          totalPromptTokens: 10,
          totalCompletionTokens: 20,
          totalTokens: 30,
          requestCount: 4,
          lastUsedAt: '2026-01-03T00:00:00Z'
        },
        disabled: false,
        disabledAt: null,
        disabledBy: null,
        markedForDeletionAt: null,
        markedForDeletionBy: null
      }
    });
  });

  it('routes detail reads through v2 admin service paths', async () => {
    fetchMock.mockImplementation(async () => jsonResponse({}));

    await apiClient.admin.groups.getMembers('group-1');
    await apiClient.admin.organizations.get('org-1');
    await apiClient.admin.organizations.getUsers('org-1');
    await apiClient.admin.organizations.getGroups('org-1');
    await apiClient.admin.users.get('user-1');

    const urls = fetchMock.mock.calls.map(([url]) => String(url));
    expect(
      urls.some((url) =>
        url.includes('/connect/tearleads.v2.AdminService/GetGroupMembers')
      )
    ).toBe(true);
    expect(
      urls.some((url) =>
        url.includes('/connect/tearleads.v2.AdminService/GetOrganization')
      )
    ).toBe(true);
    expect(
      urls.some((url) =>
        url.includes('/connect/tearleads.v2.AdminService/GetOrgUsers')
      )
    ).toBe(true);
    expect(
      urls.some((url) =>
        url.includes('/connect/tearleads.v2.AdminService/GetOrgGroups')
      )
    ).toBe(true);
    expect(
      urls.some((url) =>
        url.includes('/connect/tearleads.v2.AdminService/GetUser')
      )
    ).toBe(true);
  });
});
