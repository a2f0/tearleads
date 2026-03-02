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

import { mlsConnectService } from './mlsService.js';

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

describe('mlsConnectService', () => {
  beforeEach(() => {
    callRouteJsonHandlerMock.mockReset();
    callRouteJsonHandlerMock.mockResolvedValue('{"ok":true}');
  });

  it('routes mls handlers to the expected route handlers', async () => {
    const context = createContext();

    const cases: JsonCallCase[] = [
      {
        call: () =>
          mlsConnectService.uploadKeyPackages(
            {
              json: '{"keyPackages":[]}'
            },
            context
          ),
        method: 'POST',
        path: '/mls/key-packages',
        jsonBody: '{"keyPackages":[]}'
      },
      {
        call: () => mlsConnectService.getMyKeyPackages({}, context),
        method: 'GET',
        path: '/mls/key-packages/me'
      },
      {
        call: () =>
          mlsConnectService.getUserKeyPackages(
            {
              userId: 'user-1'
            },
            context
          ),
        method: 'GET',
        path: '/mls/key-packages/user-1'
      },
      {
        call: () =>
          mlsConnectService.deleteKeyPackage(
            {
              id: 'pkg-1'
            },
            context
          ),
        method: 'DELETE',
        path: '/mls/key-packages/pkg-1'
      },
      {
        call: () =>
          mlsConnectService.createGroup(
            {
              json: '{"name":"g"}'
            },
            context
          ),
        method: 'POST',
        path: '/mls/groups',
        jsonBody: '{"name":"g"}'
      },
      {
        call: () => mlsConnectService.listGroups({}, context),
        method: 'GET',
        path: '/mls/groups'
      },
      {
        call: () =>
          mlsConnectService.getGroup(
            {
              groupId: 'group-1'
            },
            context
          ),
        method: 'GET',
        path: '/mls/groups/group-1'
      },
      {
        call: () =>
          mlsConnectService.updateGroup(
            {
              groupId: 'group-2',
              json: '{"name":"next"}'
            },
            context
          ),
        method: 'PATCH',
        path: '/mls/groups/group-2',
        jsonBody: '{"name":"next"}'
      },
      {
        call: () =>
          mlsConnectService.deleteGroup(
            {
              groupId: 'group-3'
            },
            context
          ),
        method: 'DELETE',
        path: '/mls/groups/group-3'
      },
      {
        call: () =>
          mlsConnectService.addGroupMember(
            {
              groupId: 'group-4',
              json: '{"userId":"u1"}'
            },
            context
          ),
        method: 'POST',
        path: '/mls/groups/group-4/members',
        jsonBody: '{"userId":"u1"}'
      },
      {
        call: () =>
          mlsConnectService.getGroupMembers(
            {
              groupId: 'group-5'
            },
            context
          ),
        method: 'GET',
        path: '/mls/groups/group-5/members'
      },
      {
        call: () =>
          mlsConnectService.removeGroupMember(
            {
              groupId: 'group-6',
              userId: 'u2',
              json: '{"newEpoch":2}'
            },
            context
          ),
        method: 'DELETE',
        path: '/mls/groups/group-6/members/u2',
        jsonBody: '{"newEpoch":2}'
      },
      {
        call: () =>
          mlsConnectService.sendGroupMessage(
            {
              groupId: 'group-7',
              json: '{"ciphertext":"x"}'
            },
            context
          ),
        method: 'POST',
        path: '/vfs/mls/groups/group-7/messages',
        jsonBody: '{"ciphertext":"x"}'
      },
      {
        call: () =>
          mlsConnectService.getGroupMessages(
            {
              groupId: 'group-8',
              cursor: 'c-1',
              limit: 20
            },
            context
          ),
        method: 'GET',
        path: '/vfs/mls/groups/group-8/messages',
        query: 'cursor=c-1&limit=20'
      },
      {
        call: () =>
          mlsConnectService.getGroupState(
            {
              groupId: 'group-9'
            },
            context
          ),
        method: 'GET',
        path: '/mls/groups/group-9/state'
      },
      {
        call: () =>
          mlsConnectService.uploadGroupState(
            {
              groupId: 'group-10',
              json: '{"epoch":3}'
            },
            context
          ),
        method: 'POST',
        path: '/mls/groups/group-10/state',
        jsonBody: '{"epoch":3}'
      },
      {
        call: () => mlsConnectService.getWelcomeMessages({}, context),
        method: 'GET',
        path: '/mls/welcome-messages'
      },
      {
        call: () =>
          mlsConnectService.acknowledgeWelcome(
            {
              id: 'welcome-1',
              json: '{"groupId":"g"}'
            },
            context
          ),
        method: 'POST',
        path: '/mls/welcome-messages/welcome-1/ack',
        jsonBody: '{"groupId":"g"}'
      }
    ];

    for (const testCase of cases) {
      const response = await testCase.call();
      expect(response).toEqual({ json: '{"ok":true}' });
      expectLastJsonCall(context, testCase);
    }
  });

  it('omits optional query params for empty mls values', async () => {
    const context = createContext();

    await mlsConnectService.getGroupMessages(
      {
        groupId: 'group-1',
        cursor: '',
        limit: 0
      },
      context
    );

    expectLastJsonCall(context, {
      method: 'GET',
      path: '/vfs/mls/groups/group-1/messages'
    });
  });
});
