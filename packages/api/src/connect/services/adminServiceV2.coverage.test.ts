import { create } from '@bufbuild/protobuf';
import {
  AdminAddGroupMemberRequestSchema,
  AdminCreateGroupRequestSchema,
  AdminCreateOrganizationRequestSchema,
  AdminDeleteGroupRequestSchema,
  AdminDeleteOrganizationRequestSchema,
  AdminDeleteRedisKeyRequestSchema,
  AdminGetColumnsRequestSchema,
  AdminGetGroupMembersRequestSchema,
  AdminGetGroupRequestSchema,
  AdminGetOrganizationRequestSchema,
  AdminGetOrgGroupsRequestSchema,
  AdminGetOrgUsersRequestSchema,
  AdminGetRedisDbSizeRequestSchema,
  AdminGetRedisKeysRequestSchema,
  AdminGetRedisValueRequestSchema,
  AdminGetRowsRequestSchema,
  AdminGetUserRequestSchema,
  AdminListGroupsRequestSchema,
  AdminListOrganizationsRequestSchema,
  AdminListUsersRequestSchema,
  AdminRemoveGroupMemberRequestSchema,
  AdminUpdateGroupRequestSchema,
  AdminUpdateOrganizationRequestSchema,
  AdminUpdateUserOrganizationIdsSchema,
  AdminUpdateUserRequestSchema
} from '@tearleads/shared/gen/tearleads/v2/admin_pb';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
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
}));

vi.mock('./adminDirectContext.js', () => ({
  getContextDirect: mocks.getContextDirect
}));

vi.mock('./adminDirectGroupMutations.js', () => ({
  addGroupMemberDirect: mocks.addGroupMemberDirect,
  createGroupDirect: mocks.createGroupDirect,
  deleteGroupDirect: mocks.deleteGroupDirect,
  removeGroupMemberDirect: mocks.removeGroupMemberDirect,
  updateGroupDirect: mocks.updateGroupDirect
}));

vi.mock('./adminDirectGroups.js', () => ({
  getGroupDirect: mocks.getGroupDirect,
  getGroupMembersDirect: mocks.getGroupMembersDirect,
  listGroupsDirect: mocks.listGroupsDirect
}));

vi.mock('./adminDirectOrganizations.js', () => ({
  createOrganizationDirect: mocks.createOrganizationDirect,
  deleteOrganizationDirect: mocks.deleteOrganizationDirect,
  getOrganizationDirect: mocks.getOrganizationDirect,
  getOrganizationGroupsDirect: mocks.getOrganizationGroupsDirect,
  getOrganizationUsersDirect: mocks.getOrganizationUsersDirect,
  listOrganizationsDirect: mocks.listOrganizationsDirect,
  updateOrganizationDirect: mocks.updateOrganizationDirect
}));

vi.mock('./adminDirectPostgres.js', () => ({
  getColumnsDirect: mocks.getColumnsDirect,
  getPostgresInfoDirect: mocks.getPostgresInfoDirect,
  getRowsDirect: mocks.getRowsDirect,
  getTablesDirect: mocks.getTablesDirect
}));

vi.mock('./adminDirectRedis.js', () => ({
  deleteRedisKeyDirect: mocks.deleteRedisKeyDirect,
  getRedisDbSizeDirect: mocks.getRedisDbSizeDirect,
  getRedisKeysDirect: mocks.getRedisKeysDirect,
  getRedisValueDirect: mocks.getRedisValueDirect
}));

vi.mock('./adminDirectUsers.js', () => ({
  getUserDirect: mocks.getUserDirect,
  listUsersDirect: mocks.listUsersDirect,
  updateUserDirect: mocks.updateUserDirect
}));

import { adminConnectServiceV2 } from './adminServiceV2.js';

const context = {
  requestHeader: new Headers()
};

const emptyResponse = { json: '{}' };

describe('adminConnectServiceV2 coverage branches', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('forwards list/get/delete handlers and applies organization defaults', async () => {
    mocks.listGroupsDirect.mockResolvedValue(emptyResponse);
    mocks.getGroupDirect.mockResolvedValue(emptyResponse);
    mocks.deleteGroupDirect.mockResolvedValue(emptyResponse);
    mocks.getGroupMembersDirect.mockResolvedValue(emptyResponse);
    mocks.removeGroupMemberDirect.mockResolvedValue(emptyResponse);
    mocks.listOrganizationsDirect.mockResolvedValue(emptyResponse);
    mocks.getOrganizationDirect.mockResolvedValue(emptyResponse);
    mocks.getOrganizationUsersDirect.mockResolvedValue(emptyResponse);
    mocks.getOrganizationGroupsDirect.mockResolvedValue(emptyResponse);
    mocks.deleteOrganizationDirect.mockResolvedValue(emptyResponse);
    mocks.listUsersDirect.mockResolvedValue(emptyResponse);
    mocks.getUserDirect.mockResolvedValue(emptyResponse);
    mocks.getColumnsDirect.mockResolvedValue(emptyResponse);
    mocks.getRedisKeysDirect.mockResolvedValue(emptyResponse);
    mocks.deleteRedisKeyDirect.mockResolvedValue(emptyResponse);
    mocks.getRedisDbSizeDirect.mockResolvedValue(emptyResponse);

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
    await adminConnectServiceV2.removeGroupMember(
      create(AdminRemoveGroupMemberRequestSchema, {
        id: 'group-1',
        userId: 'user-1'
      }),
      context
    );
    await adminConnectServiceV2.listOrganizations(
      create(AdminListOrganizationsRequestSchema),
      context
    );
    await adminConnectServiceV2.listOrganizations(
      create(AdminListOrganizationsRequestSchema, { organizationId: 'org-1' }),
      context
    );
    await adminConnectServiceV2.getOrganization(
      create(AdminGetOrganizationRequestSchema, { id: 'org-1' }),
      context
    );
    await adminConnectServiceV2.getOrgUsers(
      create(AdminGetOrgUsersRequestSchema, { id: 'org-1' }),
      context
    );
    await adminConnectServiceV2.getOrgGroups(
      create(AdminGetOrgGroupsRequestSchema, { id: 'org-1' }),
      context
    );
    await adminConnectServiceV2.deleteOrganization(
      create(AdminDeleteOrganizationRequestSchema, { id: 'org-1' }),
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
        pattern: '*',
        limit: 10,
        offset: 0
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
    expect(mocks.listOrganizationsDirect).toHaveBeenNthCalledWith(
      1,
      { organizationId: '' },
      context
    );
    expect(mocks.listOrganizationsDirect).toHaveBeenNthCalledWith(
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
    expect(mocks.getOrganizationUsersDirect).toHaveBeenCalledWith(
      { id: 'org-1' },
      context
    );
    expect(mocks.getOrganizationGroupsDirect).toHaveBeenCalledWith(
      { id: 'org-1' },
      context
    );
  });

  it('serializes group and organization mutation payloads', async () => {
    mocks.createGroupDirect.mockResolvedValue(emptyResponse);
    mocks.updateGroupDirect.mockResolvedValue(emptyResponse);
    mocks.addGroupMemberDirect.mockResolvedValue(emptyResponse);
    mocks.createOrganizationDirect.mockResolvedValue(emptyResponse);
    mocks.updateOrganizationDirect.mockResolvedValue(emptyResponse);

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
    await adminConnectServiceV2.createOrganization(
      create(AdminCreateOrganizationRequestSchema, {
        name: 'Org 2',
        description: 'Org description'
      }),
      context
    );
    await adminConnectServiceV2.updateOrganization(
      create(AdminUpdateOrganizationRequestSchema, {
        id: 'org-2',
        name: 'Org 2 Updated',
        description: 'Updated org'
      }),
      context
    );
    await adminConnectServiceV2.updateOrganization(
      create(AdminUpdateOrganizationRequestSchema, { id: 'org-3' }),
      context
    );

    expect(JSON.parse(mocks.createGroupDirect.mock.calls[0]?.[0].json)).toEqual({
      organizationId: 'org-2',
      name: 'Ops',
      description: 'Operations'
    });
    expect(JSON.parse(mocks.updateGroupDirect.mock.calls[0]?.[0].json)).toEqual({
      organizationId: 'org-2',
      name: 'Ops Team',
      description: 'Updated'
    });
    expect(JSON.parse(mocks.updateGroupDirect.mock.calls[1]?.[0].json)).toEqual(
      {}
    );
    expect(
      JSON.parse(mocks.createOrganizationDirect.mock.calls[0]?.[0].json)
    ).toEqual({
      name: 'Org 2',
      description: 'Org description'
    });
    expect(
      JSON.parse(mocks.updateOrganizationDirect.mock.calls[0]?.[0].json)
    ).toEqual({
      name: 'Org 2 Updated',
      description: 'Updated org'
    });
    expect(
      JSON.parse(mocks.updateOrganizationDirect.mock.calls[1]?.[0].json)
    ).toEqual({});
  });

  it('serializes updateUser optional fields and empty updates', async () => {
    mocks.updateUserDirect.mockResolvedValue(emptyResponse);

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

    expect(JSON.parse(mocks.updateUserDirect.mock.calls[0]?.[0].json)).toEqual({
      email: 'user2@example.com',
      emailConfirmed: true,
      admin: true,
      organizationIds: ['org-1', 'org-2'],
      disabled: false,
      markedForDeletion: true
    });
    expect(JSON.parse(mocks.updateUserDirect.mock.calls[1]?.[0].json)).toEqual(
      {}
    );
  });

  it('maps row sort values with explicit and default fallbacks', async () => {
    mocks.getRowsDirect.mockResolvedValue(emptyResponse);

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

  it('normalizes redis list values into oneof listValue shape', async () => {
    mocks.getRedisValueDirect.mockResolvedValueOnce({
      json: JSON.stringify({
        key: 'letters',
        type: 'list',
        ttl: 2,
        value: ['a', 'b']
      })
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

  it('normalizes redis map values into oneof mapValue shape', async () => {
    mocks.getRedisValueDirect.mockResolvedValueOnce({
      json: JSON.stringify({
        key: 'flags',
        type: 'hash',
        ttl: 10,
        value: {
          featureA: 'on',
          featureB: 'off'
        }
      })
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
