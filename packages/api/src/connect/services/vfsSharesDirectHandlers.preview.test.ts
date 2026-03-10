import { Code } from '@connectrpc/connect';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const authenticateMock = vi.fn();
const buildSharePolicyPreviewTreeMock = vi.fn();
const getPoolMock = vi.fn();
const queryMock = vi.fn();
const resolveOrganizationMembershipMock = vi.fn();

vi.mock('./connectRequestAuth.js', () => ({
  authenticate: (...args: unknown[]) => authenticateMock(...args),
  resolveOrganizationMembership: (...args: unknown[]) =>
    resolveOrganizationMembershipMock(...args)
}));

vi.mock('../../lib/postgres.js', () => ({
  getPool: (...args: unknown[]) => getPoolMock(...args),
  getPostgresPool: vi.fn()
}));

vi.mock('../../lib/vfsSharePolicyPreviewTree.js', () => ({
  buildSharePolicyPreviewTree: (...args: unknown[]) =>
    buildSharePolicyPreviewTreeMock(...args)
}));

import { getSharePolicyPreviewDirect } from './vfsSharesDirectHandlers.js';

let consoleErrorSpy: ReturnType<typeof vi.spyOn> | null = null;

describe('vfsSharesDirectHandlers preview', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    queryMock.mockReset();
    getPoolMock.mockReset();
    authenticateMock.mockReset();
    resolveOrganizationMembershipMock.mockReset();
    buildSharePolicyPreviewTreeMock.mockReset();

    getPoolMock.mockResolvedValue({
      query: queryMock
    });
    authenticateMock.mockResolvedValue({
      ok: true,
      claims: { sub: 'user-1' },
      session: { userId: 'user-1' }
    });
    resolveOrganizationMembershipMock.mockResolvedValue({
      ok: true,
      organizationId: null
    });
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleErrorSpy?.mockRestore();
    consoleErrorSpy = null;
  });

  it('validates share preview request fields and objectType filters', async () => {
    await expect(
      getSharePolicyPreviewDirect(
        {
          rootItemId: ' ',
          principalType: 'user',
          principalId: 'user-2',
          limit: 10,
          cursor: '',
          maxDepth: 2,
          q: '',
          objectType: []
        },
        {
          requestHeader: new Headers()
        }
      )
    ).rejects.toMatchObject({
      code: Code.InvalidArgument
    });

    await expect(
      getSharePolicyPreviewDirect(
        {
          rootItemId: 'root-1',
          principalType: 'device',
          principalId: 'user-2',
          limit: 10,
          cursor: '',
          maxDepth: 2,
          q: '',
          objectType: []
        },
        {
          requestHeader: new Headers()
        }
      )
    ).rejects.toMatchObject({
      code: Code.InvalidArgument
    });

    await expect(
      getSharePolicyPreviewDirect(
        {
          rootItemId: 'root-1',
          principalType: 'user',
          principalId: 'user-2',
          limit: 10,
          cursor: '',
          maxDepth: 2,
          q: '',
          objectType: ['x'.repeat(65)]
        },
        {
          requestHeader: new Headers()
        }
      )
    ).rejects.toMatchObject({
      code: Code.InvalidArgument
    });

    await expect(
      getSharePolicyPreviewDirect(
        {
          rootItemId: 'root-1',
          principalType: 'user',
          principalId: 'user-2',
          limit: 10,
          cursor: '',
          maxDepth: 2,
          q: '',
          objectType: [
            Array.from({ length: 26 }, (_, index) => `t${index}`).join(',')
          ]
        },
        {
          requestHeader: new Headers()
        }
      )
    ).rejects.toMatchObject({
      code: Code.InvalidArgument
    });
  });

  it('returns root-item authorization errors for share preview', async () => {
    queryMock.mockResolvedValueOnce({
      rows: []
    });

    await expect(
      getSharePolicyPreviewDirect(
        {
          rootItemId: 'root-1',
          principalType: 'user',
          principalId: 'user-2',
          limit: 10,
          cursor: '',
          maxDepth: 2,
          q: '',
          objectType: []
        },
        {
          requestHeader: new Headers()
        }
      )
    ).rejects.toMatchObject({
      code: Code.NotFound
    });

    queryMock.mockReset();
    queryMock.mockResolvedValueOnce({
      rows: [{ owner_id: 'user-2', object_type: 'folder' }]
    });
    await expect(
      getSharePolicyPreviewDirect(
        {
          rootItemId: 'root-1',
          principalType: 'user',
          principalId: 'user-2',
          limit: 10,
          cursor: '',
          maxDepth: 2,
          q: '',
          objectType: []
        },
        {
          requestHeader: new Headers()
        }
      )
    ).rejects.toMatchObject({
      code: Code.PermissionDenied
    });

    queryMock.mockReset();
    queryMock.mockResolvedValueOnce({
      rows: [{ owner_id: 'user-1', object_type: 'file' }]
    });
    await expect(
      getSharePolicyPreviewDirect(
        {
          rootItemId: 'root-1',
          principalType: 'user',
          principalId: 'user-2',
          limit: 10,
          cursor: '',
          maxDepth: 2,
          q: '',
          objectType: []
        },
        {
          requestHeader: new Headers()
        }
      )
    ).rejects.toMatchObject({
      code: Code.InvalidArgument
    });
  });

  it('builds share preview and normalizes limit/depth/search/object types', async () => {
    queryMock.mockResolvedValueOnce({
      rows: [{ owner_id: 'user-1', object_type: 'folder' }]
    });
    buildSharePolicyPreviewTreeMock.mockResolvedValueOnce({
      nodes: [
        {
          itemId: 'root-1',
          objectType: 'folder',
          depth: 0,
          path: 'root-1',
          state: 'direct',
          effectiveAccessLevel: 'read',
          sourcePolicyIds: ['policy-1']
        }
      ],
      summary: {
        totalMatchingNodes: 1,
        returnedNodes: 1,
        directCount: 1,
        derivedCount: 0,
        deniedCount: 0,
        includedCount: 1,
        excludedCount: 0
      },
      nextCursor: 'cursor-2'
    });

    const response = await getSharePolicyPreviewDirect(
      {
        rootItemId: 'root-1',
        principalType: 'organization',
        principalId: 'org-2',
        limit: 999,
        cursor: 'cursor-1',
        maxDepth: 999,
        q: 'note',
        objectType: ['folder,note,folder']
      },
      {
        requestHeader: new Headers()
      }
    );

    expect(response).toMatchObject({
      nodes: [
        {
          itemId: 'root-1',
          objectType: 'folder',
          depth: 0,
          path: 'root-1',
          state: 'direct',
          effectiveAccessLevel: 'read',
          sourcePolicyIds: ['policy-1']
        }
      ],
      summary: {
        totalMatchingNodes: 1,
        returnedNodes: 1,
        directCount: 1,
        derivedCount: 0,
        deniedCount: 0,
        includedCount: 1,
        excludedCount: 0
      },
      nextCursor: 'cursor-2'
    });
    expect(buildSharePolicyPreviewTreeMock).toHaveBeenCalledWith(
      expect.anything(),
      {
        rootItemId: 'root-1',
        principalType: 'organization',
        principalId: 'org-2',
        limit: 500,
        cursor: 'cursor-1',
        maxDepth: 50,
        search: 'note',
        objectTypes: ['folder', 'note']
      }
    );
  });

  it('converts unexpected preview failures to internal errors', async () => {
    queryMock.mockResolvedValueOnce({
      rows: [{ owner_id: 'user-1', object_type: 'folder' }]
    });
    buildSharePolicyPreviewTreeMock.mockRejectedValueOnce(new Error('failed'));

    await expect(
      getSharePolicyPreviewDirect(
        {
          rootItemId: 'root-1',
          principalType: 'user',
          principalId: 'user-2',
          limit: 1,
          cursor: '',
          maxDepth: 1,
          q: '',
          objectType: []
        },
        {
          requestHeader: new Headers()
        }
      )
    ).rejects.toMatchObject({
      code: Code.Internal
    });
  });
});
