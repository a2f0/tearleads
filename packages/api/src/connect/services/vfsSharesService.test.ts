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

import { vfsSharesConnectService } from './vfsSharesService.js';

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

describe('vfsSharesConnectService', () => {
  beforeEach(() => {
    callRouteJsonHandlerMock.mockReset();
    callRouteJsonHandlerMock.mockResolvedValue('{"ok":true}');
  });

  it('routes vfs shares handlers to the expected route handlers', async () => {
    const context = createContext();

    const cases: JsonCallCase[] = [
      {
        call: () =>
          vfsSharesConnectService.getItemShares(
            {
              itemId: 'item-1'
            },
            context
          ),
        method: 'GET',
        path: '/vfs/items/item-1/shares'
      },
      {
        call: () =>
          vfsSharesConnectService.createShare(
            {
              itemId: 'item-1',
              json: '{"targetId":"u1"}'
            },
            context
          ),
        method: 'POST',
        path: '/vfs/items/item-1/shares',
        jsonBody: '{"targetId":"u1"}'
      },
      {
        call: () =>
          vfsSharesConnectService.updateShare(
            {
              shareId: 'share-1',
              json: '{"permissionLevel":"view"}'
            },
            context
          ),
        method: 'PATCH',
        path: '/vfs/shares/share-1',
        jsonBody: '{"permissionLevel":"view"}'
      },
      {
        call: () =>
          vfsSharesConnectService.deleteShare(
            {
              shareId: 'share-2'
            },
            context
          ),
        method: 'DELETE',
        path: '/vfs/shares/share-2'
      },
      {
        call: () =>
          vfsSharesConnectService.createOrgShare(
            {
              itemId: 'item-2',
              json: '{"targetOrgId":"org-2"}'
            },
            context
          ),
        method: 'POST',
        path: '/vfs/items/item-2/org-shares',
        jsonBody: '{"targetOrgId":"org-2"}'
      },
      {
        call: () =>
          vfsSharesConnectService.deleteOrgShare(
            {
              shareId: 'org-share-1'
            },
            context
          ),
        method: 'DELETE',
        path: '/vfs/org-shares/org-share-1'
      },
      {
        call: () =>
          vfsSharesConnectService.searchShareTargets(
            {
              q: 'ali',
              type: 'user'
            },
            context
          ),
        method: 'GET',
        path: '/vfs/share-targets/search',
        query: 'q=ali&type=user'
      },
      {
        call: () =>
          vfsSharesConnectService.getSharePolicyPreview(
            {
              rootItemId: 'root-1',
              principalType: 'user',
              principalId: 'user-1',
              limit: 50,
              cursor: 'cur-1',
              maxDepth: 4,
              q: 'note',
              objectType: ['folder', 'note']
            },
            context
          ),
        method: 'GET',
        path: '/vfs/share-policies/preview',
        query:
          'rootItemId=root-1&principalType=user&principalId=user-1&limit=50&cursor=cur-1&maxDepth=4&q=note&objectType=folder%2Cnote'
      }
    ];

    for (const testCase of cases) {
      const response = await testCase.call();
      expect(response).toEqual({ json: '{"ok":true}' });
      expectLastJsonCall(context, testCase);
    }
  });

  it('omits optional query params for empty values', async () => {
    const context = createContext();

    await vfsSharesConnectService.getSharePolicyPreview(
      {
        rootItemId: '',
        principalType: '',
        principalId: '',
        limit: 0,
        cursor: ' ',
        maxDepth: 0,
        q: '',
        objectType: []
      },
      context
    );

    expectLastJsonCall(context, {
      method: 'GET',
      path: '/vfs/share-policies/preview'
    });
  });
});
