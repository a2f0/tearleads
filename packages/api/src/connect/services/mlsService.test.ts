import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  acknowledgeWelcomeDirectMock,
  callRouteJsonHandlerMock,
  deleteKeyPackageDirectMock,
  getMyKeyPackagesDirectMock,
  getUserKeyPackagesDirectMock,
  getWelcomeMessagesDirectMock,
  uploadKeyPackagesDirectMock
} = vi.hoisted(() => ({
  acknowledgeWelcomeDirectMock: vi.fn(),
  callRouteJsonHandlerMock: vi.fn<(options: unknown) => Promise<string>>(),
  deleteKeyPackageDirectMock: vi.fn(),
  getMyKeyPackagesDirectMock: vi.fn(),
  getUserKeyPackagesDirectMock: vi.fn(),
  getWelcomeMessagesDirectMock: vi.fn(),
  uploadKeyPackagesDirectMock: vi.fn()
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

vi.mock('./mlsDirectKeyPackages.js', () => ({
  uploadKeyPackagesDirect: (...args: unknown[]) =>
    uploadKeyPackagesDirectMock(...args),
  getMyKeyPackagesDirect: (...args: unknown[]) =>
    getMyKeyPackagesDirectMock(...args),
  getUserKeyPackagesDirect: (...args: unknown[]) =>
    getUserKeyPackagesDirectMock(...args),
  deleteKeyPackageDirect: (...args: unknown[]) =>
    deleteKeyPackageDirectMock(...args)
}));

vi.mock('./mlsDirectWelcomeMessages.js', () => ({
  getWelcomeMessagesDirect: (...args: unknown[]) =>
    getWelcomeMessagesDirectMock(...args),
  acknowledgeWelcomeDirect: (...args: unknown[]) =>
    acknowledgeWelcomeDirectMock(...args)
}));

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
    uploadKeyPackagesDirectMock.mockReset();
    getMyKeyPackagesDirectMock.mockReset();
    getUserKeyPackagesDirectMock.mockReset();
    deleteKeyPackageDirectMock.mockReset();
    getWelcomeMessagesDirectMock.mockReset();
    acknowledgeWelcomeDirectMock.mockReset();

    callRouteJsonHandlerMock.mockResolvedValue('{"ok":true}');
    uploadKeyPackagesDirectMock.mockResolvedValue({ json: '{"direct":true}' });
    getMyKeyPackagesDirectMock.mockResolvedValue({ json: '{"direct":true}' });
    getUserKeyPackagesDirectMock.mockResolvedValue({ json: '{"direct":true}' });
    deleteKeyPackageDirectMock.mockResolvedValue({ json: '{"direct":true}' });
    getWelcomeMessagesDirectMock.mockResolvedValue({ json: '{"direct":true}' });
    acknowledgeWelcomeDirectMock.mockResolvedValue({ json: '{"direct":true}' });
  });

  it('delegates key package and welcome methods to direct modules', async () => {
    const context = createContext();

    await expect(
      mlsConnectService.uploadKeyPackages(
        { json: '{"keyPackages":[]}' },
        context
      )
    ).resolves.toEqual({ json: '{"direct":true}' });
    expect(uploadKeyPackagesDirectMock).toHaveBeenCalledWith(
      { json: '{"keyPackages":[]}' },
      context
    );

    await expect(
      mlsConnectService.getMyKeyPackages({}, context)
    ).resolves.toEqual({ json: '{"direct":true}' });
    expect(getMyKeyPackagesDirectMock).toHaveBeenCalledWith({}, context);

    await expect(
      mlsConnectService.getUserKeyPackages({ userId: 'user-1' }, context)
    ).resolves.toEqual({ json: '{"direct":true}' });
    expect(getUserKeyPackagesDirectMock).toHaveBeenCalledWith(
      { userId: 'user-1' },
      context
    );

    await expect(
      mlsConnectService.deleteKeyPackage({ id: 'pkg-1' }, context)
    ).resolves.toEqual({ json: '{"direct":true}' });
    expect(deleteKeyPackageDirectMock).toHaveBeenCalledWith(
      { id: 'pkg-1' },
      context
    );

    await expect(
      mlsConnectService.getWelcomeMessages({}, context)
    ).resolves.toEqual({ json: '{"direct":true}' });
    expect(getWelcomeMessagesDirectMock).toHaveBeenCalledWith({}, context);

    await expect(
      mlsConnectService.acknowledgeWelcome(
        { id: 'welcome-1', json: '{"groupId":"g"}' },
        context
      )
    ).resolves.toEqual({ json: '{"direct":true}' });
    expect(acknowledgeWelcomeDirectMock).toHaveBeenCalledWith(
      { id: 'welcome-1', json: '{"groupId":"g"}' },
      context
    );

    expect(callRouteJsonHandlerMock).not.toHaveBeenCalled();
  });

  it('routes remaining mls methods to legacy route handlers', async () => {
    const context = createContext();

    const cases: JsonCallCase[] = [
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
