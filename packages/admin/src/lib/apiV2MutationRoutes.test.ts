import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' }
  });
}

function parseJsonBody(
  body: BodyInit | null | undefined
): Record<string, unknown> {
  if (typeof body !== 'string') {
    throw new Error('expected request body to be a JSON string');
  }

  const parsed = JSON.parse(body);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('expected JSON body to decode to an object');
  }

  return parsed;
}

describe('admin api client v2 mutation routes', () => {
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

  it('maps v2 mutation payloads to admin DTO shapes', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        group: {
          id: 'group-1',
          organizationId: 'org-1',
          name: 'Core Team',
          description: 'Primary group',
          createdAt: '2026-02-01T00:00:00Z',
          updatedAt: '2026-02-02T00:00:00Z'
        }
      })
    );
    await expect(
      apiClient.adminV2.groups.create({
        organizationId: 'org-1',
        name: 'Core Team',
        description: 'Primary group'
      })
    ).resolves.toEqual({
      group: {
        id: 'group-1',
        organizationId: 'org-1',
        name: 'Core Team',
        description: 'Primary group',
        createdAt: '2026-02-01T00:00:00Z',
        updatedAt: '2026-02-02T00:00:00Z'
      }
    });

    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        group: {
          id: 'group-1',
          organizationId: 'org-1',
          name: 'Core Team Updated',
          description: 'Updated',
          createdAt: '2026-02-01T00:00:00Z',
          updatedAt: '2026-02-03T00:00:00Z'
        }
      })
    );
    await expect(
      apiClient.adminV2.groups.update('group-1', {
        name: 'Core Team Updated',
        description: 'Updated'
      })
    ).resolves.toEqual({
      group: {
        id: 'group-1',
        organizationId: 'org-1',
        name: 'Core Team Updated',
        description: 'Updated',
        createdAt: '2026-02-01T00:00:00Z',
        updatedAt: '2026-02-03T00:00:00Z'
      }
    });

    fetchMock.mockResolvedValueOnce(jsonResponse({ deleted: true }));
    await expect(apiClient.adminV2.groups.delete('group-1')).resolves.toEqual({
      deleted: true
    });

    fetchMock.mockResolvedValueOnce(jsonResponse({ added: true }));
    await expect(
      apiClient.adminV2.groups.addMember('group-1', 'user-1')
    ).resolves.toEqual({
      added: true
    });

    fetchMock.mockResolvedValueOnce(jsonResponse({ removed: true }));
    await expect(
      apiClient.adminV2.groups.removeMember('group-1', 'user-1')
    ).resolves.toEqual({
      removed: true
    });

    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        organization: {
          id: 'org-2',
          name: 'Platform',
          description: 'Platform org',
          createdAt: '2026-02-01T00:00:00Z',
          updatedAt: '2026-02-02T00:00:00Z'
        }
      })
    );
    await expect(
      apiClient.adminV2.organizations.create({
        name: 'Platform',
        description: 'Platform org'
      })
    ).resolves.toEqual({
      organization: {
        id: 'org-2',
        name: 'Platform',
        description: 'Platform org',
        createdAt: '2026-02-01T00:00:00Z',
        updatedAt: '2026-02-02T00:00:00Z'
      }
    });

    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        organization: {
          id: 'org-2',
          name: 'Platform Updated',
          description: 'Updated org',
          createdAt: '2026-02-01T00:00:00Z',
          updatedAt: '2026-02-03T00:00:00Z'
        }
      })
    );
    await expect(
      apiClient.adminV2.organizations.update('org-2', {
        name: 'Platform Updated',
        description: 'Updated org'
      })
    ).resolves.toEqual({
      organization: {
        id: 'org-2',
        name: 'Platform Updated',
        description: 'Updated org',
        createdAt: '2026-02-01T00:00:00Z',
        updatedAt: '2026-02-03T00:00:00Z'
      }
    });

    fetchMock.mockResolvedValueOnce(jsonResponse({ deleted: true }));
    await expect(
      apiClient.adminV2.organizations.delete('org-2')
    ).resolves.toEqual({
      deleted: true
    });

    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        user: {
          id: 'user-1',
          email: 'admin@example.com',
          emailConfirmed: true,
          admin: true,
          organizationIds: ['org-1', 'org-2'],
          createdAt: '2026-02-01T00:00:00Z',
          lastActiveAt: '2026-02-03T00:00:00Z',
          accounting: {
            totalPromptTokens: '11',
            totalCompletionTokens: '22',
            totalTokens: '33',
            requestCount: '4',
            lastUsedAt: '2026-02-03T00:00:00Z'
          },
          disabled: false
        }
      })
    );
    await expect(
      apiClient.adminV2.users.update('user-1', {
        email: 'admin@example.com',
        emailConfirmed: true,
        admin: true,
        organizationIds: ['org-1', 'org-2'],
        disabled: false,
        markedForDeletion: false
      })
    ).resolves.toEqual({
      user: {
        id: 'user-1',
        email: 'admin@example.com',
        emailConfirmed: true,
        admin: true,
        organizationIds: ['org-1', 'org-2'],
        createdAt: '2026-02-01T00:00:00Z',
        lastActiveAt: '2026-02-03T00:00:00Z',
        accounting: {
          totalPromptTokens: 11,
          totalCompletionTokens: 22,
          totalTokens: 33,
          requestCount: 4,
          lastUsedAt: '2026-02-03T00:00:00Z'
        },
        disabled: false,
        disabledAt: null,
        disabledBy: null,
        markedForDeletionAt: null,
        markedForDeletionBy: null
      }
    });
  });

  it('routes admin mutations through v2 service paths and typed payloads', async () => {
    fetchMock.mockImplementation(async () => jsonResponse({}));

    await apiClient.adminV2.groups.create({
      organizationId: 'org-1',
      name: 'Core Team',
      description: 'Primary group'
    });
    await apiClient.adminV2.groups.update('group-1', {
      organizationId: 'org-1',
      name: 'Core Team Updated',
      description: 'Updated'
    });
    await apiClient.adminV2.groups.delete('group-1');
    await apiClient.adminV2.groups.addMember('group-1', 'user-1');
    await apiClient.adminV2.groups.removeMember('group-1', 'user-1');
    await apiClient.adminV2.organizations.create({
      name: 'Platform',
      description: 'Platform org'
    });
    await apiClient.adminV2.organizations.update('org-1', {
      name: 'Platform Updated',
      description: 'Updated org'
    });
    await apiClient.adminV2.organizations.delete('org-1');
    await apiClient.adminV2.users.update('user-1', {
      email: 'admin@example.com',
      emailConfirmed: true,
      admin: true,
      organizationIds: ['org-1'],
      disabled: false,
      markedForDeletion: false
    });

    const urls = fetchMock.mock.calls.map(([url]) => String(url));
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
        url.includes('/connect/tearleads.v2.AdminService/UpdateUser')
      )
    ).toBe(true);
    expect(
      urls.some((url) => url.includes('/connect/tearleads.v1.AdminService/'))
    ).toBe(false);

    const updateUserCall = fetchMock.mock.calls.find(([url]) =>
      String(url).includes('/connect/tearleads.v2.AdminService/UpdateUser')
    );
    expect(updateUserCall).toBeDefined();
    if (!updateUserCall) {
      throw new Error('expected UpdateUser call');
    }

    const updateUserBody = parseJsonBody(updateUserCall[1]?.body);
    expect(updateUserBody['id']).toBe('user-1');
    expect(updateUserBody['email']).toBe('admin@example.com');
    expect(updateUserBody['organizationIds']).toEqual({
      organizationIds: ['org-1']
    });
    expect(updateUserBody['disabled']).toBe(false);
    expect(updateUserBody['markedForDeletion']).toBe(false);
  });
});
