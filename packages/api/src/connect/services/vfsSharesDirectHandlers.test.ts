import { Code } from '@connectrpc/connect';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const {
  authenticateMock,
  getPoolMock,
  getPostgresPoolMock,
  queryMock,
  resolveOrganizationMembershipMock
} = vi.hoisted(() => ({
  authenticateMock: vi.fn(),
  getPoolMock: vi.fn(),
  getPostgresPoolMock: vi.fn(),
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
  getPostgresPool: (...args: unknown[]) => getPostgresPoolMock(...args)
}));

import {
  deleteOrgShareDirect,
  deleteShareDirect,
  requireVfsSharesClaims,
  searchShareTargetsDirect
} from './vfsSharesDirectHandlers.js';

let consoleErrorSpy: ReturnType<typeof vi.spyOn> | null = null;

describe('vfsSharesDirectHandlers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    queryMock.mockReset();
    getPoolMock.mockReset();
    getPostgresPoolMock.mockReset();
    authenticateMock.mockReset();
    resolveOrganizationMembershipMock.mockReset();

    getPoolMock.mockResolvedValue({
      query: queryMock
    });
    getPostgresPoolMock.mockResolvedValue({
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

  it('returns claims when auth and membership succeed', async () => {
    const claims = await requireVfsSharesClaims(
      '/connect/tearleads.v2.VfsSharesService/DeleteShare',
      new Headers()
    );
    expect(claims).toEqual({ sub: 'user-1' });
  });

  it('maps auth and membership failures to connect errors', async () => {
    authenticateMock.mockResolvedValueOnce({
      ok: false,
      status: 401,
      error: 'Unauthorized'
    });

    await expect(
      requireVfsSharesClaims(
        '/connect/tearleads.v2.VfsSharesService/DeleteShare',
        new Headers()
      )
    ).rejects.toMatchObject({
      code: Code.Unauthenticated
    });

    authenticateMock.mockResolvedValueOnce({
      ok: true,
      claims: { sub: 'user-1' },
      session: { userId: 'user-1' }
    });
    resolveOrganizationMembershipMock.mockResolvedValueOnce({
      ok: false,
      status: 403,
      error: 'Forbidden'
    });

    await expect(
      requireVfsSharesClaims(
        '/connect/tearleads.v2.VfsSharesService/DeleteShare',
        new Headers()
      )
    ).rejects.toMatchObject({
      code: Code.PermissionDenied
    });
  });

  it('returns delete=false when no share row was updated', async () => {
    queryMock
      .mockResolvedValueOnce({
        rows: [
          {
            owner_id: 'user-1',
            acl_id: 'share:share-1',
            item_id: 'item-1',
            principal_type: 'user',
            principal_id: 'user-2',
            access_level: 'read'
          }
        ]
      })
      .mockResolvedValueOnce({ rowCount: 0 });

    const response = await deleteShareDirect(
      {
        shareId: 'share-1'
      },
      {
        requestHeader: new Headers()
      }
    );
    expect(response).toEqual({
      deleted: false
    });
  });

  it('returns not found and permission denied for share deletes', async () => {
    queryMock.mockResolvedValueOnce({
      rows: []
    });

    await expect(
      deleteShareDirect(
        {
          shareId: 'missing-share'
        },
        {
          requestHeader: new Headers()
        }
      )
    ).rejects.toMatchObject({
      code: Code.NotFound
    });

    queryMock.mockResolvedValueOnce({
      rows: [
        {
          owner_id: 'user-2',
          acl_id: 'share:share-1',
          item_id: 'item-1',
          principal_type: 'user',
          principal_id: 'user-2',
          access_level: 'read'
        }
      ]
    });

    await expect(
      deleteShareDirect(
        {
          shareId: 'share-1'
        },
        {
          requestHeader: new Headers()
        }
      )
    ).rejects.toMatchObject({
      code: Code.PermissionDenied
    });
  });

  it('converts unexpected org delete failures to internal errors', async () => {
    getPostgresPoolMock.mockRejectedValueOnce(new Error('db unavailable'));

    await expect(
      deleteOrgShareDirect(
        {
          shareId: 'org-share-1'
        },
        {
          requestHeader: new Headers()
        }
      )
    ).rejects.toMatchObject({
      code: Code.Internal
    });
  });

  it('rejects empty share-target search queries', async () => {
    await expect(
      searchShareTargetsDirect(
        {
          q: '   ',
          type: ''
        },
        {
          requestHeader: new Headers()
        }
      )
    ).rejects.toMatchObject({
      code: Code.InvalidArgument
    });
  });

  it('searches across user/group/org targets when type filter is invalid', async () => {
    queryMock
      .mockResolvedValueOnce({
        rows: [{ organization_id: 'org-1' }]
      })
      .mockResolvedValueOnce({
        rows: [{ id: 'user-2', email: 'target@example.com' }]
      })
      .mockResolvedValueOnce({
        rows: [{ id: 'group-1', name: 'Eng', org_name: null }]
      })
      .mockResolvedValueOnce({
        rows: [{ id: 'org-1', name: 'Org One', description: null }]
      });

    const response = await searchShareTargetsDirect(
      {
        q: 'ta',
        type: 'not-a-valid-type'
      },
      {
        requestHeader: new Headers()
      }
    );
    if (!Array.isArray(response.results)) {
      throw new Error('Expected search results');
    }

    expect(response.results).toMatchObject([
      { id: 'user-2', type: 'user', name: 'target@example.com' },
      { id: 'group-1', type: 'group', name: 'Eng' },
      { id: 'org-1', type: 'organization', name: 'Org One' }
    ]);
  });

  it('applies type filter and query fallback behavior for search targets', async () => {
    queryMock
      .mockResolvedValueOnce({
        rows: []
      })
      .mockResolvedValueOnce({
        rows: [{ organization_id: 'org-1' }]
      })
      .mockResolvedValueOnce({
        rows: [{ id: 'user-2', email: 'alice@example.com' }]
      });

    const emptyOrgResult = await searchShareTargetsDirect(
      {
        q: 'alice',
        type: 'user'
      },
      {
        requestHeader: new Headers()
      }
    );
    expect(emptyOrgResult).toMatchObject({ results: [] });

    const userOnlyResult = await searchShareTargetsDirect(
      {
        q: 'alice',
        type: 'user'
      },
      {
        requestHeader: new Headers()
      }
    );
    expect(userOnlyResult).toMatchObject({
      results: [{ id: 'user-2', type: 'user', name: 'alice@example.com' }]
    });
  });

  it('converts unexpected search failures to internal errors', async () => {
    getPoolMock.mockRejectedValueOnce(new Error('db unavailable'));

    await expect(
      searchShareTargetsDirect(
        {
          q: 'alice',
          type: ''
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
