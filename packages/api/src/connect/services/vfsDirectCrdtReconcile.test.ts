import { Code, ConnectError } from '@connectrpc/connect';
import { encodeVfsSyncCursor } from '@tearleads/vfs-sync/vfs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { getPostgresPoolMock, queryMock, requireVfsClaimsMock } = vi.hoisted(
  () => ({
    getPostgresPoolMock: vi.fn(),
    queryMock: vi.fn(),
    requireVfsClaimsMock: vi.fn()
  })
);

vi.mock('../../lib/postgres.js', () => ({
  getPostgresPool: (...args: unknown[]) => getPostgresPoolMock(...args)
}));

vi.mock('./vfsDirectAuth.js', () => ({
  requireVfsClaims: (...args: unknown[]) => requireVfsClaimsMock(...args)
}));

import { reconcileCrdtDirect } from './vfsDirectCrdtReconcile.js';

let consoleErrorSpy: ReturnType<typeof vi.spyOn> | null = null;

function parseJson(json: string): unknown {
  return JSON.parse(json);
}

describe('vfsDirectCrdtReconcile', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    getPostgresPoolMock.mockReset();
    queryMock.mockReset();
    requireVfsClaimsMock.mockReset();

    getPostgresPoolMock.mockResolvedValue({
      query: queryMock
    });
    requireVfsClaimsMock.mockResolvedValue({
      sub: 'user-1'
    });

    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleErrorSpy?.mockRestore();
    consoleErrorSpy = null;
  });

  it('rejects invalid payloads', async () => {
    await expect(
      reconcileCrdtDirect(
        {
          json: '{}'
        },
        {
          requestHeader: new Headers()
        }
      )
    ).rejects.toMatchObject({
      code: Code.InvalidArgument
    });

    expect(queryMock).not.toHaveBeenCalled();
  });

  it('rejects clientId values containing a colon', async () => {
    const cursor = encodeVfsSyncCursor({
      changedAt: '2026-03-03T00:00:00.000Z',
      changeId: 'change-1'
    });

    await expect(
      reconcileCrdtDirect(
        {
          json: JSON.stringify({
            clientId: 'bad:client',
            cursor,
            lastReconciledWriteIds: {}
          })
        },
        {
          requestHeader: new Headers()
        }
      )
    ).rejects.toMatchObject({
      code: Code.InvalidArgument
    });

    expect(queryMock).not.toHaveBeenCalled();
  });

  it('forwards declared organization id to VFS auth claims', async () => {
    queryMock.mockResolvedValueOnce({
      rows: [
        {
          last_reconciled_at: new Date('2026-03-03T00:00:00.000Z'),
          last_reconciled_change_id: 'change-2',
          last_reconciled_write_ids: { replicaA: 7 }
        }
      ]
    });
    const inputCursor = encodeVfsSyncCursor({
      changedAt: '2026-03-03T00:00:00.000Z',
      changeId: 'change-1'
    });

    await reconcileCrdtDirect(
      {
        organizationId: 'org-1',
        json: JSON.stringify({
          clientId: 'desktop-1',
          cursor: inputCursor,
          lastReconciledWriteIds: { replicaA: 5 }
        })
      },
      {
        requestHeader: new Headers()
      }
    );

    expect(requireVfsClaimsMock).toHaveBeenCalledWith(
      '/vfs/crdt/reconcile',
      expect.any(Headers),
      {
        requireDeclaredOrganization: true,
        declaredOrganizationId: 'org-1'
      }
    );
  });

  it('stores reconcile cursor state and returns encoded response', async () => {
    queryMock.mockResolvedValueOnce({
      rows: [
        {
          last_reconciled_at: new Date('2026-03-03T00:00:00.000Z'),
          last_reconciled_change_id: 'change-2',
          last_reconciled_write_ids: { replicaA: 7 }
        }
      ]
    });

    const inputCursor = encodeVfsSyncCursor({
      changedAt: '2026-03-03T00:00:00.000Z',
      changeId: 'change-1'
    });

    const response = await reconcileCrdtDirect(
      {
        json: JSON.stringify({
          clientId: 'desktop-1',
          cursor: inputCursor,
          lastReconciledWriteIds: { replicaA: 5 }
        })
      },
      {
        requestHeader: new Headers()
      }
    );

    expect(parseJson(response.json)).toEqual({
      clientId: 'desktop-1',
      cursor: encodeVfsSyncCursor({
        changedAt: '2026-03-03T00:00:00.000Z',
        changeId: 'change-2'
      }),
      lastReconciledWriteIds: {
        replicaA: 7
      }
    });
  });

  it('maps query failures to Internal', async () => {
    queryMock.mockRejectedValueOnce(new Error('db down'));
    const inputCursor = encodeVfsSyncCursor({
      changedAt: '2026-03-03T00:00:00.000Z',
      changeId: 'change-1'
    });

    await expect(
      reconcileCrdtDirect(
        {
          json: JSON.stringify({
            clientId: 'desktop-1',
            cursor: inputCursor,
            lastReconciledWriteIds: {}
          })
        },
        {
          requestHeader: new Headers()
        }
      )
    ).rejects.toMatchObject({
      code: Code.Internal
    });
  });

  it('returns Internal when reconcile query returns no row', async () => {
    queryMock.mockResolvedValueOnce({
      rows: []
    });
    const inputCursor = encodeVfsSyncCursor({
      changedAt: '2026-03-03T00:00:00.000Z',
      changeId: 'change-1'
    });

    await expect(
      reconcileCrdtDirect(
        {
          json: JSON.stringify({
            clientId: 'desktop-1',
            cursor: inputCursor,
            lastReconciledWriteIds: {}
          })
        },
        {
          requestHeader: new Headers()
        }
      )
    ).rejects.toMatchObject({
      code: Code.Internal
    });
  });

  it('preserves ConnectError failures', async () => {
    queryMock.mockRejectedValueOnce(
      new ConnectError('boom', Code.PermissionDenied)
    );
    const inputCursor = encodeVfsSyncCursor({
      changedAt: '2026-03-03T00:00:00.000Z',
      changeId: 'change-1'
    });

    await expect(
      reconcileCrdtDirect(
        {
          json: JSON.stringify({
            clientId: 'desktop-1',
            cursor: inputCursor,
            lastReconciledWriteIds: {}
          })
        },
        {
          requestHeader: new Headers()
        }
      )
    ).rejects.toMatchObject({
      code: Code.PermissionDenied
    });
  });
});
