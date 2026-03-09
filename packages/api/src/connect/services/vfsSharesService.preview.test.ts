import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  authenticateMock,
  buildSharePolicyPreviewTreeMock,
  getPoolMock,
  queryMock,
  resolveOrganizationMembershipMock
} = vi.hoisted(() => ({
  authenticateMock: vi.fn(),
  buildSharePolicyPreviewTreeMock: vi.fn(),
  getPoolMock: vi.fn(),
  queryMock: vi.fn(),
  resolveOrganizationMembershipMock: vi.fn()
}));

vi.mock('./connectRequestAuth.js', () => ({
  authenticate: (...args: unknown[]) => authenticateMock(...args),
  resolveOrganizationMembership: (...args: unknown[]) =>
    resolveOrganizationMembershipMock(...args)
}));

vi.mock('../../lib/postgres.js', () => ({
  getPool: (...args: unknown[]) => getPoolMock(...args),
  getPostgresPool: (...args: unknown[]) => getPoolMock(...args)
}));

vi.mock('../../lib/vfsSharePolicyPreviewTree.js', () => ({
  buildSharePolicyPreviewTree: (...args: unknown[]) =>
    buildSharePolicyPreviewTreeMock(...args)
}));

import { vfsSharesConnectService } from './vfsSharesService.js';

const DIRECT_PREVIEW_NODE = {
  itemId: 'root-1',
  objectType: 'folder',
  depth: 0,
  path: 'root-1',
  state: 'direct',
  effectiveAccessLevel: 'read',
  sourcePolicyIds: []
};

const DIRECT_PREVIEW_SUMMARY = {
  totalMatchingNodes: 1,
  returnedNodes: 1,
  directCount: 1,
  derivedCount: 0,
  deniedCount: 0,
  includedCount: 1,
  excludedCount: 0
};

const EMPTY_PREVIEW_SUMMARY = {
  totalMatchingNodes: 0,
  returnedNodes: 0,
  directCount: 0,
  derivedCount: 0,
  deniedCount: 0,
  includedCount: 0,
  excludedCount: 0
};

function createContext() {
  return {
    requestHeader: new Headers({
      authorization: 'Bearer token-1',
      'x-organization-id': 'org-1'
    })
  };
}

describe('vfsSharesConnectService preview', () => {
  beforeEach(() => {
    vi.clearAllMocks();
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

  it('builds share-policy preview directly without proxy forwarding', async () => {
    const context = createContext();
    queryMock.mockResolvedValueOnce({
      rows: [{ owner_id: 'user-1', object_type: 'folder' }]
    });
    buildSharePolicyPreviewTreeMock.mockResolvedValue({
      nodes: [DIRECT_PREVIEW_NODE],
      summary: DIRECT_PREVIEW_SUMMARY,
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

    expect(response).toMatchObject({
      nodes: [DIRECT_PREVIEW_NODE],
      summary: DIRECT_PREVIEW_SUMMARY
    });
    expect(response.nextCursor).toBeUndefined();
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
    buildSharePolicyPreviewTreeMock.mockResolvedValue({
      nodes: [],
      summary: EMPTY_PREVIEW_SUMMARY,
      nextCursor: null
    });

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
