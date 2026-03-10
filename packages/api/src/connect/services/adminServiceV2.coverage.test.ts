import { create } from '@bufbuild/protobuf';
import {
  AdminAddGroupMemberRequestSchema,
  AdminCreateGroupRequestSchema,
  AdminDeleteGroupRequestSchema,
  AdminDeleteRedisKeyRequestSchema,
  AdminGetColumnsRequestSchema,
  AdminGetGroupMembersRequestSchema,
  AdminGetGroupRequestSchema,
  AdminGetRedisDbSizeRequestSchema,
  AdminGetRedisKeysRequestSchema,
  AdminGetRedisValueRequestSchema,
  AdminGetRowsRequestSchema,
  AdminGetUserRequestSchema,
  AdminListGroupsRequestSchema,
  AdminListUsersRequestSchema,
  AdminRemoveGroupMemberRequestSchema,
  AdminUpdateGroupRequestSchema,
  AdminUpdateUserOrganizationIdsSchema,
  AdminUpdateUserRequestSchema
} from '@tearleads/shared/gen/tearleads/v2/admin_pb';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = {
  getContextDirect: vi.fn(),
  addGroupMemberDirect: vi.fn(),
  createGroupDirect: vi.fn(),
  deleteGroupDirect: vi.fn(),
  removeGroupMemberDirect: vi.fn(),
  updateGroupDirect: vi.fn(),
  getGroupDirect: vi.fn(),
  getGroupMembersDirect: vi.fn(),
  listGroupsDirect: vi.fn(),
  createOrganizationDirect: vi.fn(),
  deleteOrganizationDirect: vi.fn(),
  getOrganizationDirect: vi.fn(),
  getOrganizationGroupsDirect: vi.fn(),
  getOrganizationUsersDirect: vi.fn(),
  listOrganizationsDirect: vi.fn(),
  updateOrganizationDirect: vi.fn(),
  getColumnsDirect: vi.fn(),
  getPostgresInfoDirect: vi.fn(),
  getRowsDirect: vi.fn(),
  getTablesDirect: vi.fn(),
  deleteRedisKeyDirect: vi.fn(),
  getRedisDbSizeDirect: vi.fn(),
  getRedisKeysDirect: vi.fn(),
  getRedisValueDirect: vi.fn(),
  getUserDirect: vi.fn(),
  listUsersDirect: vi.fn(),
  updateUserDirect: vi.fn()
};

vi.mock('./adminDirectContext.js', () => ({
  getContextDirect: (...args: unknown[]) => mocks.getContextDirect(...args)
}));

vi.mock('./adminDirectGroupMutations.js', () => ({
  addGroupMemberDirect: (...args: unknown[]) =>
    mocks.addGroupMemberDirect(...args),
  createGroupDirect: (...args: unknown[]) => mocks.createGroupDirect(...args),
  deleteGroupDirect: (...args: unknown[]) => mocks.deleteGroupDirect(...args),
  removeGroupMemberDirect: (...args: unknown[]) =>
    mocks.removeGroupMemberDirect(...args),
  updateGroupDirect: (...args: unknown[]) => mocks.updateGroupDirect(...args)
}));

vi.mock('./adminDirectGroups.js', () => ({
  getGroupDirect: (...args: unknown[]) => mocks.getGroupDirect(...args),
  getGroupMembersDirect: (...args: unknown[]) =>
    mocks.getGroupMembersDirect(...args),
  listGroupsDirect: (...args: unknown[]) => mocks.listGroupsDirect(...args)
}));

vi.mock('./adminDirectOrganizations.js', () => ({
  createOrganizationDirect: (...args: unknown[]) =>
    mocks.createOrganizationDirect(...args),
  deleteOrganizationDirect: (...args: unknown[]) =>
    mocks.deleteOrganizationDirect(...args),
  getOrganizationDirect: (...args: unknown[]) =>
    mocks.getOrganizationDirect(...args),
  getOrganizationGroupsDirect: (...args: unknown[]) =>
    mocks.getOrganizationGroupsDirect(...args),
  getOrganizationUsersDirect: (...args: unknown[]) =>
    mocks.getOrganizationUsersDirect(...args),
  listOrganizationsDirect: (...args: unknown[]) =>
    mocks.listOrganizationsDirect(...args),
  updateOrganizationDirect: (...args: unknown[]) =>
    mocks.updateOrganizationDirect(...args)
}));

vi.mock('./adminDirectPostgres.js', () => ({
  getColumnsDirect: (...args: unknown[]) => mocks.getColumnsDirect(...args),
  getPostgresInfoDirect: (...args: unknown[]) =>
    mocks.getPostgresInfoDirect(...args),
  getRowsDirect: (...args: unknown[]) => mocks.getRowsDirect(...args),
  getTablesDirect: (...args: unknown[]) => mocks.getTablesDirect(...args)
}));

vi.mock('./adminDirectRedis.js', () => ({
  deleteRedisKeyDirect: (...args: unknown[]) =>
    mocks.deleteRedisKeyDirect(...args),
  getRedisDbSizeDirect: (...args: unknown[]) =>
    mocks.getRedisDbSizeDirect(...args),
  getRedisKeysDirect: (...args: unknown[]) => mocks.getRedisKeysDirect(...args),
  getRedisValueDirect: (...args: unknown[]) =>
    mocks.getRedisValueDirect(...args)
}));

vi.mock('./adminDirectUsers.js', () => ({
  getUserDirect: (...args: unknown[]) => mocks.getUserDirect(...args),
  listUsersDirect: (...args: unknown[]) => mocks.listUsersDirect(...args),
  updateUserDirect: (...args: unknown[]) => mocks.updateUserDirect(...args)
}));

import { adminConnectServiceV2 } from './adminServiceV2.js';

const context = {
  requestHeader: new Headers()
};

const emptyJsonResponse = { json: '{}' };
const emptyDeleteGroupResponse = { deleted: false };
const emptyAddGroupMemberResponse = { added: false };
const emptyRemoveGroupMemberResponse = { removed: false };
const emptyRedisKeysResponse = { keys: [], cursor: '', hasMore: false };
const emptyDeleteRedisKeyResponse = { deleted: false };
const emptyRedisDbSizeResponse = { count: 0n };
const emptyListUsersResponse = { users: [] };
const emptyGetUserResponse = {};
const emptyUpdateUserResponse = {};

describe('adminConnectServiceV2 coverage branches', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('forwards group, user, postgres, and redis handlers', async () => {
    mocks.listGroupsDirect.mockResolvedValue(emptyJsonResponse);
    mocks.getGroupDirect.mockResolvedValue(emptyJsonResponse);
    mocks.deleteGroupDirect.mockResolvedValue(emptyDeleteGroupResponse);
    mocks.getGroupMembersDirect.mockResolvedValue(emptyJsonResponse);
    mocks.removeGroupMemberDirect.mockResolvedValue(
      emptyRemoveGroupMemberResponse
    );
    mocks.listUsersDirect.mockResolvedValue(emptyListUsersResponse);
    mocks.getUserDirect.mockResolvedValue(emptyGetUserResponse);
    mocks.getColumnsDirect.mockResolvedValue(emptyJsonResponse);
    mocks.getRedisKeysDirect.mockResolvedValue(emptyRedisKeysResponse);
    mocks.deleteRedisKeyDirect.mockResolvedValue(emptyDeleteRedisKeyResponse);
    mocks.getRedisDbSizeDirect.mockResolvedValue(emptyRedisDbSizeResponse);

    await adminConnectServiceV2.listGroups(
      create(AdminListGroupsRequestSchema),
      context
    );
    await adminConnectServiceV2.listGroups(
      create(AdminListGroupsRequestSchema, { organizationId: 'org-1' }),
      context
    );
    await adminConnectServiceV2.getGroup(
      create(AdminGetGroupRequestSchema, { id: 'group-1' }),
      context
    );
    await adminConnectServiceV2.deleteGroup(
      create(AdminDeleteGroupRequestSchema, { id: 'group-1' }),
      context
    );
    await adminConnectServiceV2.getGroupMembers(
      create(AdminGetGroupMembersRequestSchema, { id: 'group-1' }),
      context
    );
    await adminConnectServiceV2.listUsers(
      create(AdminListUsersRequestSchema),
      context
    );
    await adminConnectServiceV2.listUsers(
      create(AdminListUsersRequestSchema, { organizationId: 'org-1' }),
      context
    );
    await adminConnectServiceV2.getUser(
      create(AdminGetUserRequestSchema, { id: 'user-1' }),
      context
    );
    await adminConnectServiceV2.getColumns(
      create(AdminGetColumnsRequestSchema, {
        schema: 'public',
        table: 'users'
      }),
      context
    );
    await adminConnectServiceV2.getRedisKeys(
      create(AdminGetRedisKeysRequestSchema, {
        cursor: '0',
        limit: 10
      }),
      context
    );
    await adminConnectServiceV2.removeGroupMember(
      create(AdminRemoveGroupMemberRequestSchema, {
        groupId: 'group-1',
        userId: 'user-1'
      }),
      context
    );
    await adminConnectServiceV2.deleteRedisKey(
      create(AdminDeleteRedisKeyRequestSchema, { key: 'feature_flag' }),
      context
    );
    await adminConnectServiceV2.getRedisDbSize(
      create(AdminGetRedisDbSizeRequestSchema),
      context
    );

    expect(mocks.listGroupsDirect).toHaveBeenNthCalledWith(
      1,
      { organizationId: '' },
      context
    );
    expect(mocks.listGroupsDirect).toHaveBeenNthCalledWith(
      2,
      { organizationId: 'org-1' },
      context
    );
    expect(mocks.listUsersDirect).toHaveBeenNthCalledWith(
      1,
      { organizationId: '' },
      context
    );
    expect(mocks.listUsersDirect).toHaveBeenNthCalledWith(
      2,
      { organizationId: 'org-1' },
      context
    );
  });

  it('maps group mutation payloads', async () => {
    mocks.createGroupDirect.mockResolvedValue(emptyJsonResponse);
    mocks.updateGroupDirect.mockResolvedValue(emptyJsonResponse);
    mocks.addGroupMemberDirect.mockResolvedValue(emptyAddGroupMemberResponse);

    await adminConnectServiceV2.createGroup(
      create(AdminCreateGroupRequestSchema, {
        organizationId: 'org-2',
        name: 'Ops',
        description: 'Operations'
      }),
      context
    );
    await adminConnectServiceV2.updateGroup(
      create(AdminUpdateGroupRequestSchema, {
        id: 'group-2',
        organizationId: 'org-2',
        name: 'Ops Team',
        description: 'Updated'
      }),
      context
    );
    await adminConnectServiceV2.updateGroup(
      create(AdminUpdateGroupRequestSchema, { id: 'group-3' }),
      context
    );
    await adminConnectServiceV2.addGroupMember(
      create(AdminAddGroupMemberRequestSchema, {
        id: 'group-2',
        userId: 'user-2'
      }),
      context
    );

    expect(mocks.createGroupDirect.mock.calls[0]?.[0]).toEqual({
      organizationId: 'org-2',
      name: 'Ops',
      description: 'Operations'
    });
    expect(mocks.updateGroupDirect.mock.calls[0]?.[0]).toEqual({
      id: 'group-2',
      organizationId: 'org-2',
      name: 'Ops Team',
      description: 'Updated'
    });
    expect(mocks.updateGroupDirect.mock.calls[1]?.[0]).toEqual({
      id: 'group-3'
    });
    expect(mocks.addGroupMemberDirect.mock.calls[0]?.[0]).toEqual({
      id: 'group-2',
      userId: 'user-2'
    });
  });

  it('maps updateUser optional fields and empty updates', async () => {
    mocks.updateUserDirect.mockResolvedValue(emptyUpdateUserResponse);

    await adminConnectServiceV2.updateUser(
      create(AdminUpdateUserRequestSchema, {
        id: 'user-2',
        email: 'user2@example.com',
        emailConfirmed: true,
        admin: true,
        organizationIds: create(AdminUpdateUserOrganizationIdsSchema, {
          organizationIds: ['org-1', 'org-2']
        }),
        disabled: false,
        markedForDeletion: true
      }),
      context
    );
    await adminConnectServiceV2.updateUser(
      create(AdminUpdateUserRequestSchema, { id: 'user-3' }),
      context
    );

    expect(mocks.updateUserDirect.mock.calls[0]?.[0]).toEqual({
      id: 'user-2',
      email: 'user2@example.com',
      emailConfirmed: true,
      admin: true,
      organizationIds: ['org-1', 'org-2'],
      disabled: false,
      markedForDeletion: true
    });
    expect(mocks.updateUserDirect.mock.calls[1]?.[0]).toEqual({
      id: 'user-3'
    });
  });

  it('maps row sort values with explicit and default fallbacks', async () => {
    mocks.getRowsDirect.mockResolvedValue(emptyJsonResponse);

    await adminConnectServiceV2.getRows(
      create(AdminGetRowsRequestSchema, {
        schema: 'public',
        table: 'users',
        limit: 10,
        offset: 0
      }),
      context
    );
    await adminConnectServiceV2.getRows(
      create(AdminGetRowsRequestSchema, {
        schema: 'public',
        table: 'users',
        limit: 5,
        offset: 10,
        sortColumn: 'created_at',
        sortDirection: 'desc'
      }),
      context
    );

    expect(mocks.getRowsDirect).toHaveBeenNthCalledWith(
      1,
      {
        schema: 'public',
        table: 'users',
        limit: 10,
        offset: 0,
        sortColumn: '',
        sortDirection: ''
      },
      context
    );
    expect(mocks.getRowsDirect).toHaveBeenNthCalledWith(
      2,
      {
        schema: 'public',
        table: 'users',
        limit: 5,
        offset: 10,
        sortColumn: 'created_at',
        sortDirection: 'desc'
      },
      context
    );
  });

  it('passes through redis list values in oneof listValue shape', async () => {
    mocks.getRedisValueDirect.mockResolvedValueOnce({
      key: 'letters',
      type: 'list',
      ttl: 2n,
      value: {
        value: {
          case: 'listValue',
          value: {
            values: ['a', 'b']
          }
        }
      }
    });

    const response = await adminConnectServiceV2.getRedisValue(
      create(AdminGetRedisValueRequestSchema, { key: 'letters' }),
      context
    );

    expect(response.value?.value.case).toBe('listValue');
    if (response.value?.value.case === 'listValue') {
      expect(response.value.value.value.values).toEqual(['a', 'b']);
    }
  });

  it('passes through redis map values in oneof mapValue shape', async () => {
    mocks.getRedisValueDirect.mockResolvedValueOnce({
      key: 'flags',
      type: 'hash',
      ttl: 10n,
      value: {
        value: {
          case: 'mapValue',
          value: {
            entries: {
              featureA: 'on',
              featureB: 'off'
            }
          }
        }
      }
    });

    const response = await adminConnectServiceV2.getRedisValue(
      create(AdminGetRedisValueRequestSchema, { key: 'flags' }),
      context
    );

    expect(response.value?.value.case).toBe('mapValue');
    if (response.value?.value.case === 'mapValue') {
      expect(response.value.value.value.entries).toEqual({
        featureA: 'on',
        featureB: 'off'
      });
    }
  });
});
