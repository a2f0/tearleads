import { beforeEach, describe, expect, it, vi } from 'vitest';

const { callRouteJsonHandlerMock } = vi.hoisted(() => ({
  callRouteJsonHandlerMock: vi.fn<(options: unknown) => Promise<string>>()
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
  });

  it('routes admin handlers to the expected route handlers', async () => {
    const context = createContext();

    const cases: JsonCallCase[] = [
      {
        call: () => adminConnectService.getContext({}, context),
        method: 'GET',
        path: '/admin/context'
      },
      {
        call: () => adminConnectService.getPostgresInfo({}, context),
        method: 'GET',
        path: '/admin/postgres/info'
      },
      {
        call: () => adminConnectService.getTables({}, context),
        method: 'GET',
        path: '/admin/postgres/tables'
      },
      {
        call: () =>
          adminConnectService.getColumns(
            { schema: 'public', table: 'users' },
            context
          ),
        method: 'GET',
        path: '/admin/postgres/tables/public/users/columns'
      },
      {
        call: () =>
          adminConnectService.getRows(
            {
              schema: 'public',
              table: 'users',
              limit: 10,
              offset: 5,
              sortColumn: 'email',
              sortDirection: 'asc'
            },
            context
          ),
        method: 'GET',
        path: '/admin/postgres/tables/public/users/rows',
        query: 'limit=10&offset=5&sortColumn=email&sortDirection=asc'
      },
      {
        call: () =>
          adminConnectService.getRedisKeys(
            {
              cursor: 'c-1',
              limit: 25
            },
            context
          ),
        method: 'GET',
        path: '/admin/redis/keys',
        query: 'cursor=c-1&limit=25'
      },
      {
        call: () =>
          adminConnectService.getRedisValue({ key: 'session:1' }, context),
        method: 'GET',
        path: '/admin/redis/keys/session%3A1'
      },
      {
        call: () =>
          adminConnectService.deleteRedisKey({ key: 'session:2' }, context),
        method: 'DELETE',
        path: '/admin/redis/keys/session%3A2'
      },
      {
        call: () => adminConnectService.getRedisDbSize({}, context),
        method: 'GET',
        path: '/admin/redis/dbsize'
      },
      {
        call: () =>
          adminConnectService.listGroups({ organizationId: 'org-1' }, context),
        method: 'GET',
        path: '/admin/groups',
        query: 'organizationId=org-1'
      },
      {
        call: () => adminConnectService.getGroup({ id: 'group-1' }, context),
        method: 'GET',
        path: '/admin/groups/group-1'
      },
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
          adminConnectService.getGroupMembers({ id: 'group-4' }, context),
        method: 'GET',
        path: '/admin/groups/group-4/members'
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
  });

  it('omits optional admin query params when values are empty', async () => {
    const context = createContext();

    await adminConnectService.getRows(
      {
        schema: 'public',
        table: 'users',
        limit: 0,
        offset: -1,
        sortColumn: '',
        sortDirection: ' '
      },
      context
    );
    expectLastJsonCall(context, {
      method: 'GET',
      path: '/admin/postgres/tables/public/users/rows'
    });

    await adminConnectService.getRows(
      {
        schema: 'public',
        table: 'users',
        limit: 0,
        offset: 0,
        sortColumn: '',
        sortDirection: ''
      },
      context
    );
    expectLastJsonCall(context, {
      method: 'GET',
      path: '/admin/postgres/tables/public/users/rows',
      query: 'offset=0'
    });

    await adminConnectService.getRedisKeys(
      {
        cursor: '',
        limit: 0
      },
      context
    );
    expectLastJsonCall(context, {
      method: 'GET',
      path: '/admin/redis/keys'
    });

    await adminConnectService.listGroups({ organizationId: '' }, context);
    expectLastJsonCall(context, {
      method: 'GET',
      path: '/admin/groups'
    });
  });
});
