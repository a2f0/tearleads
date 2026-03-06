import { beforeEach, describe, expect, it, vi } from 'vitest';
import { type AdminV2Client, createAdminV2Routes } from './adminV2Routes';

interface AdminV2ClientOverrides {
  getContext?: AdminV2Client['getContext'];
  getGroup?: AdminV2Client['getGroup'];
  getGroupMembers?: AdminV2Client['getGroupMembers'];
  listOrganizations?: AdminV2Client['listOrganizations'];
  getOrganization?: AdminV2Client['getOrganization'];
  getOrgUsers?: AdminV2Client['getOrgUsers'];
  getOrgGroups?: AdminV2Client['getOrgGroups'];
  listUsers?: AdminV2Client['listUsers'];
  getUser?: AdminV2Client['getUser'];
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
    getGroup:
      overrides.getGroup ??
      vi.fn(async () => ({ group: undefined, members: [] })),
    getGroupMembers:
      overrides.getGroupMembers ?? vi.fn(async () => ({ members: [] })),
    listOrganizations:
      overrides.listOrganizations ?? vi.fn(async () => ({ organizations: [] })),
    getOrganization:
      overrides.getOrganization ??
      vi.fn(async () => ({ organization: undefined })),
    getOrgUsers: overrides.getOrgUsers ?? vi.fn(async () => ({ users: [] })),
    getOrgGroups: overrides.getOrgGroups ?? vi.fn(async () => ({ groups: [] })),
    listUsers: overrides.listUsers ?? vi.fn(async () => ({ users: [] })),
    getUser: overrides.getUser ?? vi.fn(async () => ({ user: undefined })),
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

function createRoutesForTest(client: AdminV2Client) {
  const logEvent = vi.fn(async () => undefined);
  const routes = createAdminV2Routes({
    resolveApiBaseUrl: () => 'https://api.example.test',
    normalizeConnectBaseUrl: async (apiBaseUrl) => `${apiBaseUrl}/connect`,
    buildHeaders: async () => ({ authorization: 'Bearer token-123' }),
    getAuthHeaderValue: () => 'Bearer token-123',
    createClient: () => client,
    logEvent
  });

  return {
    routes,
    logEvent
  };
}

describe('adminV2Routes detail reads', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('maps group members response and logs success', async () => {
    const getGroupMembers = vi.fn(async () => ({
      members: [
        {
          userId: 'user-1',
          email: 'admin@example.com',
          joinedAt: '2026-01-01T00:00:00Z'
        }
      ]
    }));
    const client = createAdminV2ClientStub({ getGroupMembers });
    const { routes, logEvent } = createRoutesForTest(client);

    const response = await routes.groups.getMembers('group-1');

    expect(response).toEqual({
      members: [
        {
          userId: 'user-1',
          email: 'admin@example.com',
          joinedAt: '2026-01-01T00:00:00Z'
        }
      ]
    });
    expect(getGroupMembers).toHaveBeenCalledTimes(1);
    expect(logEvent).toHaveBeenCalledWith(
      'api_get_admin_group_members',
      expect.any(Number),
      true
    );
  });

  it('maps organization detail, users, and groups responses', async () => {
    const getOrganization = vi.fn(async () => ({
      organization: {
        id: 'org-1',
        name: 'Primary Org',
        description: 'Main org',
        createdAt: '2026-01-01T00:00:00Z',
        updatedAt: '2026-01-02T00:00:00Z'
      }
    }));
    const getOrgUsers = vi.fn(async () => ({
      users: [
        {
          id: 'user-1',
          email: 'admin@example.com',
          joinedAt: '2026-01-01T00:00:00Z'
        }
      ]
    }));
    const getOrgGroups = vi.fn(async () => ({
      groups: [
        {
          id: 'group-1',
          name: 'Admins',
          description: 'Core admins',
          memberCount: 3
        }
      ]
    }));
    const client = createAdminV2ClientStub({
      getOrganization,
      getOrgUsers,
      getOrgGroups
    });
    const { routes, logEvent } = createRoutesForTest(client);

    await expect(routes.organizations.get('org-1')).resolves.toEqual({
      organization: {
        id: 'org-1',
        name: 'Primary Org',
        description: 'Main org',
        createdAt: '2026-01-01T00:00:00Z',
        updatedAt: '2026-01-02T00:00:00Z'
      }
    });
    await expect(routes.organizations.getUsers('org-1')).resolves.toEqual({
      users: [
        {
          id: 'user-1',
          email: 'admin@example.com',
          joinedAt: '2026-01-01T00:00:00Z'
        }
      ]
    });
    await expect(routes.organizations.getGroups('org-1')).resolves.toEqual({
      groups: [
        {
          id: 'group-1',
          name: 'Admins',
          description: 'Core admins',
          memberCount: 3
        }
      ]
    });
    expect(getOrganization).toHaveBeenCalledTimes(1);
    expect(getOrgUsers).toHaveBeenCalledTimes(1);
    expect(getOrgGroups).toHaveBeenCalledTimes(1);
    expect(logEvent).toHaveBeenCalledWith(
      'api_get_admin_organization',
      expect.any(Number),
      true
    );
    expect(logEvent).toHaveBeenCalledWith(
      'api_get_admin_organization_users',
      expect.any(Number),
      true
    );
    expect(logEvent).toHaveBeenCalledWith(
      'api_get_admin_organization_groups',
      expect.any(Number),
      true
    );
  });

  it('maps user detail response and logs success', async () => {
    const getUser = vi.fn(async () => ({
      user: {
        id: 'user-1',
        email: 'admin@example.com',
        emailConfirmed: true,
        admin: true,
        organizationIds: ['org-1'],
        createdAt: '2026-01-01T00:00:00Z',
        lastActiveAt: '2026-01-02T00:00:00Z',
        accounting: {
          totalPromptTokens: 10n,
          totalCompletionTokens: 20n,
          totalTokens: 30n,
          requestCount: 5n,
          lastUsedAt: '2026-01-03T00:00:00Z'
        },
        disabled: false,
        disabledAt: undefined,
        disabledBy: undefined,
        markedForDeletionAt: undefined,
        markedForDeletionBy: undefined
      }
    }));
    const client = createAdminV2ClientStub({ getUser });
    const { routes, logEvent } = createRoutesForTest(client);

    const response = await routes.users.get('user-1');

    expect(response).toEqual({
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
          requestCount: 5,
          lastUsedAt: '2026-01-03T00:00:00Z'
        },
        disabled: false,
        disabledAt: null,
        disabledBy: null,
        markedForDeletionAt: null,
        markedForDeletionBy: null
      }
    });
    expect(getUser).toHaveBeenCalledTimes(1);
    expect(logEvent).toHaveBeenCalledWith(
      'api_get_admin_user',
      expect.any(Number),
      true
    );
  });

  it('maps detail-read defaults when payload values are missing', async () => {
    const client = createAdminV2ClientStub({
      getGroupMembers: vi.fn(async () => ({ members: [] })),
      getOrganization: vi.fn(async () => ({ organization: undefined })),
      getOrgUsers: vi.fn(async () => ({ users: [] })),
      getOrgGroups: vi.fn(async () => ({ groups: [] })),
      getUser: vi.fn(async () => ({ user: undefined }))
    });
    const { routes } = createRoutesForTest(client);

    await expect(routes.groups.getMembers('group-1')).resolves.toEqual({
      members: []
    });
    await expect(routes.organizations.get('org-1')).resolves.toEqual({
      organization: {
        id: '',
        name: '',
        description: null,
        createdAt: '',
        updatedAt: ''
      }
    });
    await expect(routes.organizations.getUsers('org-1')).resolves.toEqual({
      users: []
    });
    await expect(routes.organizations.getGroups('org-1')).resolves.toEqual({
      groups: []
    });
    await expect(routes.users.get('user-1')).resolves.toEqual({
      user: {
        id: '',
        email: '',
        emailConfirmed: false,
        admin: false,
        organizationIds: [],
        createdAt: null,
        lastActiveAt: null,
        accounting: {
          totalPromptTokens: 0,
          totalCompletionTokens: 0,
          totalTokens: 0,
          requestCount: 0,
          lastUsedAt: null
        },
        disabled: false,
        disabledAt: null,
        disabledBy: null,
        markedForDeletionAt: null,
        markedForDeletionBy: null
      }
    });
  });
});
