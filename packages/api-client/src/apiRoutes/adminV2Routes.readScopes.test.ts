import { describe, expect, it, vi } from 'vitest';
import type { AdminV2Client } from './adminV2Routes';
import { createAdminV2Routes } from './adminV2Routes';

function createClientStub(
  overrides: Partial<AdminV2Client> = {}
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

describe('adminV2Routes scoped reads', () => {
  it('maps getGroup, organization detail reads, and listUsers responses', async () => {
    const logEvent = vi.fn(async () => undefined);
    const listGroups = vi.fn(async () => ({
      groups: [
        {
          id: 'group-1',
          organizationId: 'org-1',
          name: 'Core Admin',
          description: 'Operators',
          createdAt: '2026-01-01T00:00:00Z',
          updatedAt: '2026-01-02T00:00:00Z',
          memberCount: 3
        }
      ]
    }));
    const getGroup = vi.fn(async () => ({
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
    }));
    const listOrganizations = vi.fn(async () => ({
      organizations: [
        {
          id: 'org-1',
          name: 'Organization 1',
          description: 'Primary',
          createdAt: '2026-01-01T00:00:00Z',
          updatedAt: '2026-01-02T00:00:00Z'
        }
      ]
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
    const listUsers = vi.fn(async () => ({
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
          disabled: false,
          disabledAt: undefined,
          disabledBy: undefined,
          markedForDeletionAt: undefined,
          markedForDeletionBy: undefined
        }
      ]
    }));
    const client = createClientStub({
      listGroups,
      getGroup,
      listOrganizations,
      getOrgUsers,
      listUsers
    });

    const routes = createAdminV2Routes({
      resolveApiBaseUrl: () => 'https://api.example.test',
      normalizeConnectBaseUrl: async (apiBaseUrl) => `${apiBaseUrl}/connect`,
      buildHeaders: async () => ({ authorization: 'Bearer token-123' }),
      getAuthHeaderValue: () => 'Bearer token-123',
      createClient: () => client,
      logEvent
    });

    const groupsResponse = await routes.groups.list({
      organizationId: 'org-1'
    });
    const groupResponse = await routes.groups.get('group-1');
    const organizationsResponse = await routes.organizations.list({
      organizationId: 'org-1'
    });
    const organizationUsersResponse =
      await routes.organizations.getUsers('org-1');
    const usersResponse = await routes.users.list({ organizationId: 'org-1' });

    expect(groupsResponse.groups[0]?.id).toBe('group-1');
    expect(groupsResponse.groups[0]?.memberCount).toBe(3);
    expect(groupResponse.group.id).toBe('group-1');
    expect(groupResponse.members[0]?.userId).toBe('user-1');
    expect(organizationsResponse.organizations[0]?.id).toBe('org-1');
    expect(organizationUsersResponse.users[0]?.id).toBe('user-1');
    expect(organizationUsersResponse.users[0]?.joinedAt).toBe(
      '2026-01-01T00:00:00Z'
    );
    expect(usersResponse.users[0]?.accounting.totalTokens).toBe(30);
    expect(usersResponse.users[0]?.disabledAt).toBeNull();
    expect(logEvent).toHaveBeenCalledWith(
      'api_get_admin_groups',
      expect.any(Number),
      true
    );
    expect(logEvent).toHaveBeenCalledWith(
      'api_get_admin_group',
      expect.any(Number),
      true
    );
    expect(logEvent).toHaveBeenCalledWith(
      'api_get_admin_organizations',
      expect.any(Number),
      true
    );
    expect(logEvent).toHaveBeenCalledWith(
      'api_get_admin_users',
      expect.any(Number),
      true
    );
  });
});
