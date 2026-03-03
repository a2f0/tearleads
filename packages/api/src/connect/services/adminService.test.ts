import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  addGroupMemberDirectMock,
  createGroupDirectMock,
  createOrganizationDirectMock,
  deleteGroupDirectMock,
  deleteOrganizationDirectMock,
  deleteRedisKeyDirectMock,
  getColumnsDirectMock,
  getContextDirectMock,
  getGroupDirectMock,
  getGroupMembersDirectMock,
  getOrganizationDirectMock,
  getOrganizationGroupsDirectMock,
  getOrganizationUsersDirectMock,
  getPostgresInfoDirectMock,
  getRedisDbSizeDirectMock,
  getRedisKeysDirectMock,
  getRedisValueDirectMock,
  getRowsDirectMock,
  getTablesDirectMock,
  getUserDirectMock,
  listGroupsDirectMock,
  listOrganizationsDirectMock,
  listUsersDirectMock,
  removeGroupMemberDirectMock,
  updateGroupDirectMock,
  updateOrganizationDirectMock,
  updateUserDirectMock
} = vi.hoisted(() => ({
  addGroupMemberDirectMock:
    vi.fn<(request: unknown, context: unknown) => Promise<{ json: string }>>(),
  createGroupDirectMock:
    vi.fn<(request: unknown, context: unknown) => Promise<{ json: string }>>(),
  createOrganizationDirectMock:
    vi.fn<(request: unknown, context: unknown) => Promise<{ json: string }>>(),
  deleteGroupDirectMock:
    vi.fn<(request: unknown, context: unknown) => Promise<{ json: string }>>(),
  deleteOrganizationDirectMock:
    vi.fn<(request: unknown, context: unknown) => Promise<{ json: string }>>(),
  deleteRedisKeyDirectMock:
    vi.fn<(request: unknown, context: unknown) => Promise<{ json: string }>>(),
  getColumnsDirectMock:
    vi.fn<(request: unknown, context: unknown) => Promise<{ json: string }>>(),
  getContextDirectMock:
    vi.fn<(request: unknown, context: unknown) => Promise<{ json: string }>>(),
  getGroupDirectMock:
    vi.fn<(request: unknown, context: unknown) => Promise<{ json: string }>>(),
  getGroupMembersDirectMock:
    vi.fn<(request: unknown, context: unknown) => Promise<{ json: string }>>(),
  getOrganizationDirectMock:
    vi.fn<(request: unknown, context: unknown) => Promise<{ json: string }>>(),
  getOrganizationGroupsDirectMock:
    vi.fn<(request: unknown, context: unknown) => Promise<{ json: string }>>(),
  getOrganizationUsersDirectMock:
    vi.fn<(request: unknown, context: unknown) => Promise<{ json: string }>>(),
  getPostgresInfoDirectMock:
    vi.fn<(request: unknown, context: unknown) => Promise<{ json: string }>>(),
  getRedisDbSizeDirectMock:
    vi.fn<(request: unknown, context: unknown) => Promise<{ json: string }>>(),
  getRedisKeysDirectMock:
    vi.fn<(request: unknown, context: unknown) => Promise<{ json: string }>>(),
  getRedisValueDirectMock:
    vi.fn<(request: unknown, context: unknown) => Promise<{ json: string }>>(),
  getRowsDirectMock:
    vi.fn<(request: unknown, context: unknown) => Promise<{ json: string }>>(),
  getTablesDirectMock:
    vi.fn<(request: unknown, context: unknown) => Promise<{ json: string }>>(),
  getUserDirectMock:
    vi.fn<(request: unknown, context: unknown) => Promise<{ json: string }>>(),
  listGroupsDirectMock:
    vi.fn<(request: unknown, context: unknown) => Promise<{ json: string }>>(),
  listOrganizationsDirectMock:
    vi.fn<(request: unknown, context: unknown) => Promise<{ json: string }>>(),
  listUsersDirectMock:
    vi.fn<(request: unknown, context: unknown) => Promise<{ json: string }>>(),
  removeGroupMemberDirectMock:
    vi.fn<(request: unknown, context: unknown) => Promise<{ json: string }>>(),
  updateGroupDirectMock:
    vi.fn<(request: unknown, context: unknown) => Promise<{ json: string }>>(),
  updateOrganizationDirectMock:
    vi.fn<(request: unknown, context: unknown) => Promise<{ json: string }>>(),
  updateUserDirectMock:
    vi.fn<(request: unknown, context: unknown) => Promise<{ json: string }>>()
}));

vi.mock('./adminDirectContext.js', () => ({
  getContextDirect: (request: unknown, context: unknown) =>
    getContextDirectMock(request, context)
}));

vi.mock('./adminDirectGroupMutations.js', () => ({
  addGroupMemberDirect: (request: unknown, context: unknown) =>
    addGroupMemberDirectMock(request, context),
  createGroupDirect: (request: unknown, context: unknown) =>
    createGroupDirectMock(request, context),
  deleteGroupDirect: (request: unknown, context: unknown) =>
    deleteGroupDirectMock(request, context),
  removeGroupMemberDirect: (request: unknown, context: unknown) =>
    removeGroupMemberDirectMock(request, context),
  updateGroupDirect: (request: unknown, context: unknown) =>
    updateGroupDirectMock(request, context)
}));

vi.mock('./adminDirectGroups.js', () => ({
  getGroupDirect: (request: unknown, context: unknown) =>
    getGroupDirectMock(request, context),
  getGroupMembersDirect: (request: unknown, context: unknown) =>
    getGroupMembersDirectMock(request, context),
  listGroupsDirect: (request: unknown, context: unknown) =>
    listGroupsDirectMock(request, context)
}));

vi.mock('./adminDirectOrganizations.js', () => ({
  createOrganizationDirect: (request: unknown, context: unknown) =>
    createOrganizationDirectMock(request, context),
  deleteOrganizationDirect: (request: unknown, context: unknown) =>
    deleteOrganizationDirectMock(request, context),
  getOrganizationDirect: (request: unknown, context: unknown) =>
    getOrganizationDirectMock(request, context),
  getOrganizationGroupsDirect: (request: unknown, context: unknown) =>
    getOrganizationGroupsDirectMock(request, context),
  getOrganizationUsersDirect: (request: unknown, context: unknown) =>
    getOrganizationUsersDirectMock(request, context),
  listOrganizationsDirect: (request: unknown, context: unknown) =>
    listOrganizationsDirectMock(request, context),
  updateOrganizationDirect: (request: unknown, context: unknown) =>
    updateOrganizationDirectMock(request, context)
}));

vi.mock('./adminDirectPostgres.js', () => ({
  getColumnsDirect: (request: unknown, context: unknown) =>
    getColumnsDirectMock(request, context),
  getPostgresInfoDirect: (request: unknown, context: unknown) =>
    getPostgresInfoDirectMock(request, context),
  getRowsDirect: (request: unknown, context: unknown) =>
    getRowsDirectMock(request, context),
  getTablesDirect: (request: unknown, context: unknown) =>
    getTablesDirectMock(request, context)
}));

vi.mock('./adminDirectRedis.js', () => ({
  deleteRedisKeyDirect: (request: unknown, context: unknown) =>
    deleteRedisKeyDirectMock(request, context),
  getRedisDbSizeDirect: (request: unknown, context: unknown) =>
    getRedisDbSizeDirectMock(request, context),
  getRedisKeysDirect: (request: unknown, context: unknown) =>
    getRedisKeysDirectMock(request, context),
  getRedisValueDirect: (request: unknown, context: unknown) =>
    getRedisValueDirectMock(request, context)
}));

vi.mock('./adminDirectUsers.js', () => ({
  getUserDirect: (request: unknown, context: unknown) =>
    getUserDirectMock(request, context),
  listUsersDirect: (request: unknown, context: unknown) =>
    listUsersDirectMock(request, context),
  updateUserDirect: (request: unknown, context: unknown) =>
    updateUserDirectMock(request, context)
}));

import { adminConnectService } from './adminService.js';

type DelegationMock = {
  mockReset: () => void;
  mockResolvedValue: (value: { json: string }) => void;
  mock: {
    calls: unknown[][];
  };
};

type DirectCallCase = {
  call: () => Promise<{ json: string }>;
  expectedRequest: unknown;
  mock: DelegationMock;
};

function createContext() {
  return {
    requestHeader: new Headers({
      authorization: 'Bearer token-1',
      'x-organization-id': 'org-1'
    })
  };
}

function getDelegationMocks(): DelegationMock[] {
  return [
    addGroupMemberDirectMock,
    createGroupDirectMock,
    createOrganizationDirectMock,
    deleteGroupDirectMock,
    deleteOrganizationDirectMock,
    deleteRedisKeyDirectMock,
    getColumnsDirectMock,
    getContextDirectMock,
    getGroupDirectMock,
    getGroupMembersDirectMock,
    getOrganizationDirectMock,
    getOrganizationGroupsDirectMock,
    getOrganizationUsersDirectMock,
    getPostgresInfoDirectMock,
    getRedisDbSizeDirectMock,
    getRedisKeysDirectMock,
    getRedisValueDirectMock,
    getRowsDirectMock,
    getTablesDirectMock,
    getUserDirectMock,
    listGroupsDirectMock,
    listOrganizationsDirectMock,
    listUsersDirectMock,
    removeGroupMemberDirectMock,
    updateGroupDirectMock,
    updateOrganizationDirectMock,
    updateUserDirectMock
  ];
}

describe('adminConnectService', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    for (const delegationMock of getDelegationMocks()) {
      delegationMock.mockReset();
      delegationMock.mockResolvedValue({ json: '{"ok":true}' });
    }
  });

  it('delegates admin methods to direct handlers', async () => {
    const context = createContext();
    const getColumnsRequest = { schema: 'public', table: 'users' };
    const getRowsRequest = {
      schema: 'public',
      table: 'users',
      limit: 10,
      offset: 5,
      sortColumn: 'email',
      sortDirection: 'asc'
    };
    const getRedisKeysRequest = {
      cursor: 'c-1',
      limit: 25
    };
    const getRedisValueRequest = { key: 'session:1' };
    const deleteRedisKeyRequest = { key: 'session:2' };
    const listGroupsRequest = { organizationId: 'org-1' };
    const getGroupRequest = { id: 'group-1' };
    const getGroupMembersRequest = { id: 'group-2' };
    const createGroupRequest = { json: '{"name":"x"}' };
    const updateGroupRequest = { id: 'group-2', json: '{"name":"y"}' };
    const deleteGroupRequest = { id: 'group-3' };
    const addGroupMemberRequest = { id: 'group-5', json: '{"userId":"u1"}' };
    const removeGroupMemberRequest = { groupId: 'group-6', userId: 'u2' };
    const listOrganizationsRequest = { organizationId: 'org-2' };
    const getOrganizationRequest = { id: 'org-3' };
    const createOrganizationRequest = { json: '{"name":"Org"}' };
    const updateOrganizationRequest = { id: 'org-4', json: '{"name":"Org 4"}' };
    const deleteOrganizationRequest = { id: 'org-5' };
    const getOrganizationUsersRequest = { id: 'org-6' };
    const getOrganizationGroupsRequest = { id: 'org-7' };
    const listUsersRequest = { organizationId: 'org-8' };
    const getUserRequest = { id: 'user-9' };
    const updateUserRequest = { id: 'user-10', json: '{"disabled":true}' };

    const cases: DirectCallCase[] = [
      {
        call: () => adminConnectService.getContext({}, context),
        expectedRequest: {},
        mock: getContextDirectMock
      },
      {
        call: () => adminConnectService.getPostgresInfo({}, context),
        expectedRequest: {},
        mock: getPostgresInfoDirectMock
      },
      {
        call: () => adminConnectService.getTables({}, context),
        expectedRequest: {},
        mock: getTablesDirectMock
      },
      {
        call: () => adminConnectService.getColumns(getColumnsRequest, context),
        expectedRequest: getColumnsRequest,
        mock: getColumnsDirectMock
      },
      {
        call: () => adminConnectService.getRows(getRowsRequest, context),
        expectedRequest: getRowsRequest,
        mock: getRowsDirectMock
      },
      {
        call: () =>
          adminConnectService.getRedisKeys(getRedisKeysRequest, context),
        expectedRequest: getRedisKeysRequest,
        mock: getRedisKeysDirectMock
      },
      {
        call: () =>
          adminConnectService.getRedisValue(getRedisValueRequest, context),
        expectedRequest: getRedisValueRequest,
        mock: getRedisValueDirectMock
      },
      {
        call: () =>
          adminConnectService.deleteRedisKey(deleteRedisKeyRequest, context),
        expectedRequest: deleteRedisKeyRequest,
        mock: deleteRedisKeyDirectMock
      },
      {
        call: () => adminConnectService.getRedisDbSize({}, context),
        expectedRequest: {},
        mock: getRedisDbSizeDirectMock
      },
      {
        call: () => adminConnectService.listGroups(listGroupsRequest, context),
        expectedRequest: listGroupsRequest,
        mock: listGroupsDirectMock
      },
      {
        call: () => adminConnectService.getGroup(getGroupRequest, context),
        expectedRequest: getGroupRequest,
        mock: getGroupDirectMock
      },
      {
        call: () =>
          adminConnectService.getGroupMembers(getGroupMembersRequest, context),
        expectedRequest: getGroupMembersRequest,
        mock: getGroupMembersDirectMock
      },
      {
        call: () => adminConnectService.createGroup(createGroupRequest, context),
        expectedRequest: createGroupRequest,
        mock: createGroupDirectMock
      },
      {
        call: () => adminConnectService.updateGroup(updateGroupRequest, context),
        expectedRequest: updateGroupRequest,
        mock: updateGroupDirectMock
      },
      {
        call: () => adminConnectService.deleteGroup(deleteGroupRequest, context),
        expectedRequest: deleteGroupRequest,
        mock: deleteGroupDirectMock
      },
      {
        call: () =>
          adminConnectService.addGroupMember(addGroupMemberRequest, context),
        expectedRequest: addGroupMemberRequest,
        mock: addGroupMemberDirectMock
      },
      {
        call: () =>
          adminConnectService.removeGroupMember(removeGroupMemberRequest, context),
        expectedRequest: removeGroupMemberRequest,
        mock: removeGroupMemberDirectMock
      },
      {
        call: () =>
          adminConnectService.listOrganizations(listOrganizationsRequest, context),
        expectedRequest: listOrganizationsRequest,
        mock: listOrganizationsDirectMock
      },
      {
        call: () =>
          adminConnectService.getOrganization(getOrganizationRequest, context),
        expectedRequest: getOrganizationRequest,
        mock: getOrganizationDirectMock
      },
      {
        call: () =>
          adminConnectService.createOrganization(createOrganizationRequest, context),
        expectedRequest: createOrganizationRequest,
        mock: createOrganizationDirectMock
      },
      {
        call: () =>
          adminConnectService.updateOrganization(updateOrganizationRequest, context),
        expectedRequest: updateOrganizationRequest,
        mock: updateOrganizationDirectMock
      },
      {
        call: () =>
          adminConnectService.deleteOrganization(deleteOrganizationRequest, context),
        expectedRequest: deleteOrganizationRequest,
        mock: deleteOrganizationDirectMock
      },
      {
        call: () => adminConnectService.getOrgUsers(getOrganizationUsersRequest, context),
        expectedRequest: getOrganizationUsersRequest,
        mock: getOrganizationUsersDirectMock
      },
      {
        call: () =>
          adminConnectService.getOrgGroups(getOrganizationGroupsRequest, context),
        expectedRequest: getOrganizationGroupsRequest,
        mock: getOrganizationGroupsDirectMock
      },
      {
        call: () => adminConnectService.listUsers(listUsersRequest, context),
        expectedRequest: listUsersRequest,
        mock: listUsersDirectMock
      },
      {
        call: () => adminConnectService.getUser(getUserRequest, context),
        expectedRequest: getUserRequest,
        mock: getUserDirectMock
      },
      {
        call: () => adminConnectService.updateUser(updateUserRequest, context),
        expectedRequest: updateUserRequest,
        mock: updateUserDirectMock
      }
    ];

    for (const testCase of cases) {
      const response = await testCase.call();
      expect(response).toEqual({ json: '{"ok":true}' });

      const call = testCase.mock.mock.calls.at(-1);
      if (!call) {
        throw new Error('Expected direct handler to be called');
      }
      const [request, receivedContext] = call;
      expect(request).toEqual(testCase.expectedRequest);
      expect(receivedContext).toBe(context);
    }
  });
});
