import { Code } from '@connectrpc/connect';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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

vi.mock('./legacyRouteProxyAuth.js', () => ({
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseResponseJson(json: string): Record<string, unknown> {
  const parsed: unknown = JSON.parse(json);
  if (!isRecord(parsed)) {
    throw new Error('Expected record JSON payload');
  }
  return parsed;
}

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
      rows: [{ itemId: 'root-1' }],
      nextCursor: null
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

    expect(parseResponseJson(response.json)).toEqual({
      rows: [{ itemId: 'root-1' }],
      nextCursor: null
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
