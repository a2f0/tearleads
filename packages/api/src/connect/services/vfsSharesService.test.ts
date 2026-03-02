import { Code } from '@connectrpc/connect';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  authenticateMock,
  buildSharePolicyPreviewTreeMock,
  callRouteJsonHandlerMock,
  getPoolMock,
  queryMock,
  resolveOrganizationMembershipMock
} = vi.hoisted(() => ({
  authenticateMock: vi.fn(),
  buildSharePolicyPreviewTreeMock: vi.fn(),
  callRouteJsonHandlerMock: vi.fn<(options: unknown) => Promise<string>>(),
  getPoolMock: vi.fn(),
  queryMock: vi.fn(),
  resolveOrganizationMembershipMock: vi.fn()
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

vi.mock('./legacyRouteProxyAuth.js', () => ({
  authenticate: (...args: unknown[]) => authenticateMock(...args),
  resolveOrganizationMembership: (...args: unknown[]) =>
    resolveOrganizationMembershipMock(...args)
}));

vi.mock('../../lib/postgres.js', () => ({
  getPool: (...args: unknown[]) => getPoolMock(...args)
}));

vi.mock('../../lib/vfsSharePolicyPreviewTree.js', () => ({
  buildSharePolicyPreviewTree: (...args: unknown[]) =>
    buildSharePolicyPreviewTreeMock(...args)
}));

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
    vi.clearAllMocks();
    callRouteJsonHandlerMock.mockResolvedValue('{"ok":true}');
    queryMock.mockReset();
    getPoolMock.mockResolvedValue({
      query: queryMock
    });
    authenticateMock.mockResolvedValue({
      ok: true,
      claims: {
        sub: 'user-1'
      },
      session: {
        userId: 'user-1'
      }
    });
    resolveOrganizationMembershipMock.mockResolvedValue({
      ok: true,
      organizationId: null
    });
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
      }
    ];

    for (const testCase of cases) {
      const response = await testCase.call();
      expect(response).toEqual({ json: '{"ok":true}' });
      expectLastJsonCall(context, testCase);
    }
  });

  it('searches share targets directly without proxy forwarding', async () => {
    const context = createContext();
    queryMock
      .mockResolvedValueOnce({
        rows: [{ organization_id: 'org-1' }]
      })
      .mockResolvedValueOnce({
        rows: [{ id: 'user-2', email: 'alice@example.com' }]
      });

    const response = await vfsSharesConnectService.searchShareTargets(
      {
        q: 'ali',
        type: 'user'
      },
      context
    );

    expect(response).toEqual({
      json: JSON.stringify({
        results: [{ id: 'user-2', type: 'user', name: 'alice@example.com' }]
      })
    });
    expect(callRouteJsonHandlerMock).not.toHaveBeenCalled();
    expect(authenticateMock).toHaveBeenCalledWith(context.requestHeader);
    expect(resolveOrganizationMembershipMock).toHaveBeenCalledWith(
      '/vfs/share-targets/search',
      context.requestHeader,
      'user-1'
    );
    expect(getPoolMock).toHaveBeenCalledWith('read');
  });

  it('returns invalid argument for empty share-target search query', async () => {
    const context = createContext();

    await expect(
      vfsSharesConnectService.searchShareTargets(
        {
          q: '   ',
          type: ''
        },
        context
      )
    ).rejects.toMatchObject({
      code: Code.InvalidArgument
    });
  });

  it('builds share-policy preview directly without proxy forwarding', async () => {
    const context = createContext();
    queryMock.mockResolvedValueOnce({
      rows: [{ owner_id: 'user-1', object_type: 'folder' }]
    });
    buildSharePolicyPreviewTreeMock.mockResolvedValue({
      rows: [{ itemId: 'root-1' }],
      nextCursor: null
    });

    const response = await vfsSharesConnectService.getSharePolicyPreview(
      {
        rootItemId: 'root-1',
        principalType: 'user',
        principalId: 'user-2',
        limit: 50,
        cursor: 'cursor-1',
        maxDepth: 4,
        q: 'note',
        objectType: ['folder', 'note']
      },
      context
    );

    expect(response).toEqual({
      json: JSON.stringify({
        rows: [{ itemId: 'root-1' }],
        nextCursor: null
      })
    });
    expect(callRouteJsonHandlerMock).not.toHaveBeenCalled();
    expect(buildSharePolicyPreviewTreeMock).toHaveBeenCalledWith(
      expect.anything(),
      {
        rootItemId: 'root-1',
        principalType: 'user',
        principalId: 'user-2',
        limit: 50,
        cursor: 'cursor-1',
        maxDepth: 4,
        search: 'note',
        objectTypes: ['folder', 'note']
      }
    );
  });

  it('uses preview defaults when limit/maxDepth/cursor/search are empty-ish', async () => {
    const context = createContext();
    queryMock.mockResolvedValueOnce({
      rows: [{ owner_id: 'user-1', object_type: 'folder' }]
    });
    buildSharePolicyPreviewTreeMock.mockResolvedValue({});

    await vfsSharesConnectService.getSharePolicyPreview(
      {
        rootItemId: 'root-1',
        principalType: 'user',
        principalId: 'user-2',
        limit: 0,
        cursor: ' ',
        maxDepth: 0,
        q: ' ',
        objectType: []
      },
      context
    );

    expect(buildSharePolicyPreviewTreeMock).toHaveBeenCalledWith(
      expect.anything(),
      {
        rootItemId: 'root-1',
        principalType: 'user',
        principalId: 'user-2',
        limit: 100,
        cursor: null,
        maxDepth: 50,
        search: null,
        objectTypes: null
      }
    );
  });
});
