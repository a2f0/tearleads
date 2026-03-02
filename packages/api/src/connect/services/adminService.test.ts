import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  callRouteJsonHandlerMock,
  deleteRedisKeyDirectMock,
  getColumnsDirectMock,
  getContextDirectMock,
  getGroupDirectMock,
  getGroupMembersDirectMock,
  getPostgresInfoDirectMock,
  getRedisDbSizeDirectMock,
  getRedisKeysDirectMock,
  getRedisValueDirectMock,
  getRowsDirectMock,
  listGroupsDirectMock,
  getTablesDirectMock
} = vi.hoisted(() => ({
  callRouteJsonHandlerMock: vi.fn<(options: unknown) => Promise<string>>(),
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
  listGroupsDirectMock:
    vi.fn<(request: unknown, context: unknown) => Promise<{ json: string }>>(),
  getTablesDirectMock:
    vi.fn<(request: unknown, context: unknown) => Promise<{ json: string }>>()
}));

vi.mock('./legacyRouteProxy.js', async () => {
  const actual = await vi.importActual<typeof import('./legacyRouteProxy.js')>(
    './legacyRouteProxy.js'
  );

  return {
    ...actual,
    callRouteJsonHandler: callRouteJsonHandlerMock
  };
});

vi.mock('./adminDirectContext.js', () => ({
  getContextDirect: (request: unknown, context: unknown) =>
    getContextDirectMock(request, context)
}));

vi.mock('./adminDirectGroups.js', () => ({
  getGroupDirect: (request: unknown, context: unknown) =>
    getGroupDirectMock(request, context),
  getGroupMembersDirect: (request: unknown, context: unknown) =>
    getGroupMembersDirectMock(request, context),
  listGroupsDirect: (request: unknown, context: unknown) =>
    listGroupsDirectMock(request, context)
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

import { adminConnectService } from './adminService.js';

type JsonCallExpectation = {
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  path: string;
  jsonBody?: string;
  query?: string;
};

type JsonCallCase = JsonCallExpectation & {
  call: () => Promise<{ json: string }>;
};

type DirectCallCase = {
  call: () => Promise<{ json: string }>;
  expectedRequest: unknown;
  mock: {
    mock: {
      calls: unknown[][];
    };
  };
};

function createContext() {
  return {
    requestHeader: new Headers({
      authorization: 'Bearer token-1',
      'x-organization-id': 'org-1'
    })
  };
}

function isUnknownRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function expectLastJsonCall(
  context: ReturnType<typeof createContext>,
  expectation: JsonCallExpectation
): void {
  const call = callRouteJsonHandlerMock.mock.calls.at(-1);
  if (!call) {
    throw new Error('Expected callRouteJsonHandler to be called');
  }

  const [options] = call;
  if (!isUnknownRecord(options)) {
    throw new Error('Expected options object');
  }
  expect(options['context']).toBe(context);
  expect(options['method']).toBe(expectation.method);
  expect(options['path']).toBe(expectation.path);

  if (expectation.jsonBody === undefined) {
    expect(options['jsonBody']).toBeUndefined();
  } else {
    expect(options['jsonBody']).toBe(expectation.jsonBody);
  }

  const query = options['query'];
  if (query !== undefined && !(query instanceof URLSearchParams)) {
    throw new Error('Expected query to be URLSearchParams when present');
  }

  expect(query?.toString() ?? '').toBe(expectation.query ?? '');
}

describe('adminConnectService', () => {
  beforeEach(() => {
    callRouteJsonHandlerMock.mockReset();
    callRouteJsonHandlerMock.mockResolvedValue('{"ok":true}');

    getContextDirectMock.mockReset();
    getGroupDirectMock.mockReset();
    getGroupMembersDirectMock.mockReset();
    getPostgresInfoDirectMock.mockReset();
    getTablesDirectMock.mockReset();
    getColumnsDirectMock.mockReset();
    getRowsDirectMock.mockReset();
    listGroupsDirectMock.mockReset();
    getRedisKeysDirectMock.mockReset();
    getRedisValueDirectMock.mockReset();
    deleteRedisKeyDirectMock.mockReset();
    getRedisDbSizeDirectMock.mockReset();

    getContextDirectMock.mockResolvedValue({ json: '{"ok":true}' });
    getGroupDirectMock.mockResolvedValue({ json: '{"ok":true}' });
    getGroupMembersDirectMock.mockResolvedValue({ json: '{"ok":true}' });
    getPostgresInfoDirectMock.mockResolvedValue({ json: '{"ok":true}' });
    getTablesDirectMock.mockResolvedValue({ json: '{"ok":true}' });
    getColumnsDirectMock.mockResolvedValue({ json: '{"ok":true}' });
    getRowsDirectMock.mockResolvedValue({ json: '{"ok":true}' });
    listGroupsDirectMock.mockResolvedValue({ json: '{"ok":true}' });
    getRedisKeysDirectMock.mockResolvedValue({ json: '{"ok":true}' });
    getRedisValueDirectMock.mockResolvedValue({ json: '{"ok":true}' });
    deleteRedisKeyDirectMock.mockResolvedValue({ json: '{"ok":true}' });
    getRedisDbSizeDirectMock.mockResolvedValue({ json: '{"ok":true}' });
  });

  it('delegates direct admin methods to direct handlers', async () => {
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

    expect(callRouteJsonHandlerMock).not.toHaveBeenCalled();
  });

  it('routes remaining admin handlers to legacy route proxy handlers', async () => {
    const context = createContext();

    const cases: JsonCallCase[] = [
      {
        call: () =>
          adminConnectService.createGroup({ json: '{"name":"x"}' }, context),
        method: 'POST',
        path: '/admin/groups',
        jsonBody: '{"name":"x"}'
      },
      {
        call: () =>
          adminConnectService.updateGroup(
            {
              id: 'group-2',
              json: '{"name":"y"}'
            },
            context
          ),
        method: 'PUT',
        path: '/admin/groups/group-2',
        jsonBody: '{"name":"y"}'
      },
      {
        call: () => adminConnectService.deleteGroup({ id: 'group-3' }, context),
        method: 'DELETE',
        path: '/admin/groups/group-3'
      },
      {
        call: () =>
          adminConnectService.addGroupMember(
            {
              id: 'group-5',
              json: '{"userId":"u1"}'
            },
            context
          ),
        method: 'POST',
        path: '/admin/groups/group-5/members',
        jsonBody: '{"userId":"u1"}'
      },
      {
        call: () =>
          adminConnectService.removeGroupMember(
            {
              groupId: 'group-6',
              userId: 'u2'
            },
            context
          ),
        method: 'DELETE',
        path: '/admin/groups/group-6/members/u2'
      },
      {
        call: () =>
          adminConnectService.listOrganizations(
            {
              organizationId: 'org-2'
            },
            context
          ),
        method: 'GET',
        path: '/admin/organizations',
        query: 'organizationId=org-2'
      },
      {
        call: () =>
          adminConnectService.getOrganization(
            {
              id: 'org-3'
            },
            context
          ),
        method: 'GET',
        path: '/admin/organizations/org-3'
      },
      {
        call: () =>
          adminConnectService.createOrganization(
            {
              json: '{"name":"Org"}'
            },
            context
          ),
        method: 'POST',
        path: '/admin/organizations',
        jsonBody: '{"name":"Org"}'
      },
      {
        call: () =>
          adminConnectService.updateOrganization(
            {
              id: 'org-4',
              json: '{"name":"Org 4"}'
            },
            context
          ),
        method: 'PUT',
        path: '/admin/organizations/org-4',
        jsonBody: '{"name":"Org 4"}'
      },
      {
        call: () =>
          adminConnectService.deleteOrganization({ id: 'org-5' }, context),
        method: 'DELETE',
        path: '/admin/organizations/org-5'
      },
      {
        call: () => adminConnectService.getOrgUsers({ id: 'org-6' }, context),
        method: 'GET',
        path: '/admin/organizations/org-6/users'
      },
      {
        call: () => adminConnectService.getOrgGroups({ id: 'org-7' }, context),
        method: 'GET',
        path: '/admin/organizations/org-7/groups'
      },
      {
        call: () =>
          adminConnectService.listUsers({ organizationId: 'org-8' }, context),
        method: 'GET',
        path: '/admin/users',
        query: 'organizationId=org-8'
      },
      {
        call: () => adminConnectService.getUser({ id: 'user-9' }, context),
        method: 'GET',
        path: '/admin/users/user-9'
      },
      {
        call: () =>
          adminConnectService.updateUser(
            {
              id: 'user-10',
              json: '{"disabled":true}'
            },
            context
          ),
        method: 'PATCH',
        path: '/admin/users/user-10',
        jsonBody: '{"disabled":true}'
      }
    ];

    for (const testCase of cases) {
      const response = await testCase.call();
      expect(response).toEqual({ json: '{"ok":true}' });
      expectLastJsonCall(context, testCase);
    }

    expect(getContextDirectMock).not.toHaveBeenCalled();
    expect(listGroupsDirectMock).not.toHaveBeenCalled();
    expect(getGroupDirectMock).not.toHaveBeenCalled();
    expect(getGroupMembersDirectMock).not.toHaveBeenCalled();
  });

  it('omits optional query params for remaining legacy admin list endpoints', async () => {
    const context = createContext();

    await adminConnectService.listOrganizations(
      {
        organizationId: ' '
      },
      context
    );
    expectLastJsonCall(context, {
      method: 'GET',
      path: '/admin/organizations'
    });

    await adminConnectService.listUsers({ organizationId: '' }, context);
    expectLastJsonCall(context, {
      method: 'GET',
      path: '/admin/users'
    });
  });
});
