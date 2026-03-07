import { Code, ConnectError } from '@connectrpc/connect';
import { encodeVfsSyncCursor } from '@tearleads/vfs-sync/vfs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const {
  applyCrdtPushOperationsMock,
  clientQueryMock,
  clientReleaseMock,
  connectMock,
  getPostgresPoolMock,
  invalidateReplicaWriteIdRowsForUserMock,
  loadReplicaWriteIdRowsMock,
  publishVfsContainerCursorBumpMock,
  requireVfsClaimsMock
} = vi.hoisted(() => ({
  applyCrdtPushOperationsMock: vi.fn(),
  clientQueryMock: vi.fn(),
  clientReleaseMock: vi.fn(),
  connectMock: vi.fn(),
  getPostgresPoolMock: vi.fn(),
  invalidateReplicaWriteIdRowsForUserMock: vi.fn(),
  loadReplicaWriteIdRowsMock: vi.fn(),
  publishVfsContainerCursorBumpMock: vi.fn(),
  requireVfsClaimsMock: vi.fn()
}));

vi.mock('../../lib/postgres.js', () => ({
  getPostgresPool: (...args: unknown[]) => getPostgresPoolMock(...args)
}));

vi.mock('../../lib/vfsCrdtReplicaWriteIds.js', () => ({
  invalidateReplicaWriteIdRowsForUser: (...args: unknown[]) =>
    invalidateReplicaWriteIdRowsForUserMock(...args),
  loadReplicaWriteIdRows: (...args: unknown[]) =>
    loadReplicaWriteIdRowsMock(...args)
}));

vi.mock('../../lib/vfsSyncChannels.js', () => ({
  publishVfsContainerCursorBump: (...args: unknown[]) =>
    publishVfsContainerCursorBumpMock(...args)
}));

vi.mock('./vfsDirectCrdtPushApply.js', () => ({
  applyCrdtPushOperations: (...args: unknown[]) =>
    applyCrdtPushOperationsMock(...args)
}));

vi.mock('./vfsDirectAuth.js', () => ({
  requireVfsClaims: (...args: unknown[]) => requireVfsClaimsMock(...args)
}));

import { runCrdtSessionDirect } from './vfsDirectCrdtSession.js';

let consoleErrorSpy: ReturnType<typeof vi.spyOn> | null = null;

function parseJson(json: string): unknown {
  return JSON.parse(json);
}

const REQUEST_CONTEXT = {
  requestHeader: new Headers()
};

function createSessionRequest(payload: Record<string, unknown>): {
  organizationId: string;
  json: string;
} {
  return {
    organizationId: 'org-1',
    json: JSON.stringify(payload)
  };
}

function runSession(payload: Record<string, unknown>) {
  return runCrdtSessionDirect(createSessionRequest(payload), REQUEST_CONTEXT);
}

describe('vfsDirectCrdtSession', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    applyCrdtPushOperationsMock.mockReset();
    clientQueryMock.mockReset();
    clientReleaseMock.mockReset();
    connectMock.mockReset();
    getPostgresPoolMock.mockReset();
    invalidateReplicaWriteIdRowsForUserMock.mockReset();
    loadReplicaWriteIdRowsMock.mockReset();
    publishVfsContainerCursorBumpMock.mockReset();
    requireVfsClaimsMock.mockReset();

    connectMock.mockResolvedValue({
      query: clientQueryMock,
      release: clientReleaseMock
    });
    getPostgresPoolMock.mockResolvedValue({
      connect: connectMock
    });

    requireVfsClaimsMock.mockResolvedValue({
      sub: 'user-1',
      organizationId: 'org-1'
    });

    applyCrdtPushOperationsMock.mockResolvedValue({
      results: [],
      notifications: [],
      queryMetrics: {
        totalQueries: 0,
        totalDurationMs: 0,
        perQuery: {}
      }
    });

    loadReplicaWriteIdRowsMock.mockResolvedValue([]);
    invalidateReplicaWriteIdRowsForUserMock.mockResolvedValue(undefined);
    publishVfsContainerCursorBumpMock.mockResolvedValue(undefined);

    clientQueryMock
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({
        rows: [
          {
            last_reconciled_at: new Date('2026-03-03T00:00:00.000Z'),
            last_reconciled_change_id: 'change-2',
            last_reconciled_write_ids: {}
          }
        ]
      })
      .mockResolvedValueOnce({ rows: [] });

    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleErrorSpy?.mockRestore();
    consoleErrorSpy = null;
  });

  it('rejects invalid session payloads', async () => {
    await expect(
      runCrdtSessionDirect(
        {
          organizationId: '',
          json: '{}'
        },
        REQUEST_CONTEXT
      )
    ).rejects.toMatchObject({
      code: Code.InvalidArgument
    });

    expect(connectMock).not.toHaveBeenCalled();
  });

  it('rejects session payloads missing cursor', async () => {
    await expect(
      runSession({
        clientId: 'desktop-1',
        operations: [],
        limit: 10,
        lastReconciledWriteIds: {}
      })
    ).rejects.toMatchObject({
      code: Code.InvalidArgument
    });
  });

  it('rejects session payloads with invalid cursor', async () => {
    await expect(
      runSession({
        clientId: 'desktop-1',
        operations: [],
        cursor: 'not-a-cursor',
        limit: 10,
        lastReconciledWriteIds: {}
      })
    ).rejects.toMatchObject({
      code: Code.InvalidArgument
    });
  });

  it('rejects session payloads with invalid limit values', async () => {
    const inputCursor = encodeVfsSyncCursor({
      changedAt: '2026-03-03T00:00:00.000Z',
      changeId: 'change-1'
    });

    await expect(
      runSession({
        clientId: 'desktop-1',
        operations: [],
        cursor: inputCursor,
        limit: 1000,
        lastReconciledWriteIds: {}
      })
    ).rejects.toMatchObject({
      code: Code.InvalidArgument
    });
  });

  it('rejects session payloads with invalid lastReconciledWriteIds', async () => {
    const inputCursor = encodeVfsSyncCursor({
      changedAt: '2026-03-03T00:00:00.000Z',
      changeId: 'change-1'
    });

    await expect(
      runSession({
        clientId: 'desktop-1',
        operations: [],
        cursor: inputCursor,
        limit: 10,
        lastReconciledWriteIds: {
          replicaA: -1
        }
      })
    ).rejects.toMatchObject({
      code: Code.InvalidArgument
    });
  });

  it('runs push/pull/reconcile in one transaction', async () => {
    applyCrdtPushOperationsMock.mockResolvedValueOnce({
      results: [
        {
          opId: 'op-1',
          status: 'applied'
        }
      ],
      notifications: [
        {
          containerId: 'item-1',
          changedAt: '2026-03-03T00:00:00.000Z',
          changeId: 'change-1'
        }
      ],
      queryMetrics: {
        totalQueries: 0,
        totalDurationMs: 0,
        perQuery: {}
      }
    });

    const inputCursor = encodeVfsSyncCursor({
      changedAt: '2026-03-03T00:00:00.000Z',
      changeId: 'change-1'
    });

    const response = await runSession({
      clientId: 'desktop-1',
      operations: [],
      cursor: inputCursor,
      limit: 10,
      rootId: 'root-1',
      lastReconciledWriteIds: {}
    });

    expect(clientQueryMock).toHaveBeenNthCalledWith(1, 'BEGIN');
    expect(clientQueryMock).toHaveBeenNthCalledWith(4, 'COMMIT');
    expect(requireVfsClaimsMock).toHaveBeenCalledWith(
      '/vfs/crdt/session',
      expect.any(Headers),
      {
        requireDeclaredOrganization: true,
        declaredOrganizationId: 'org-1'
      }
    );
    expect(applyCrdtPushOperationsMock).toHaveBeenCalledWith({
      client: { query: clientQueryMock, release: clientReleaseMock },
      userId: 'user-1',
      organizationId: 'org-1',
      parsedOperations: []
    });
    expect(invalidateReplicaWriteIdRowsForUserMock).toHaveBeenCalledWith(
      'user-1'
    );
    expect(publishVfsContainerCursorBumpMock).toHaveBeenCalledWith({
      containerId: 'item-1',
      changedAt: '2026-03-03T00:00:00.000Z',
      changeId: 'change-1',
      actorId: 'user-1',
      sourceClientId: 'desktop-1'
    });

    expect(response).toMatchObject({
      push: {
        clientId: 'desktop-1',
        results: [
          {
            opId: 'op-1',
            status: 'applied'
          }
        ]
      },
      reconcile: {
        clientId: 'desktop-1',
        cursor: encodeVfsSyncCursor({
          changedAt: '2026-03-03T00:00:00.000Z',
          changeId: 'change-2'
        }),
        lastReconciledWriteIds: {}
      },
      pull: {
        json: expect.any(String)
      }
    });
    expect(parseJson(response.pull.json)).toEqual({
      items: [],
      nextCursor: null,
      hasMore: false,
      lastReconciledWriteIds: {}
    });

    expect(clientReleaseMock).toHaveBeenCalled();
  });

  it('rolls back and maps failures to Internal', async () => {
    applyCrdtPushOperationsMock.mockRejectedValueOnce(
      new Error('write failed')
    );

    const inputCursor = encodeVfsSyncCursor({
      changedAt: '2026-03-03T00:00:00.000Z',
      changeId: 'change-1'
    });

    await expect(
      runSession({
        clientId: 'desktop-1',
        operations: [],
        cursor: inputCursor,
        limit: 10,
        lastReconciledWriteIds: {}
      })
    ).rejects.toMatchObject({
      code: Code.Internal
    });

    expect(clientQueryMock).toHaveBeenNthCalledWith(1, 'BEGIN');
    expect(clientQueryMock).toHaveBeenNthCalledWith(2, 'ROLLBACK');
    expect(clientReleaseMock).toHaveBeenCalled();
  });

  it('accepts string limits and non-string rootId values', async () => {
    const inputCursor = encodeVfsSyncCursor({
      changedAt: '2026-03-03T00:00:00.000Z',
      changeId: 'change-1'
    });

    await expect(
      runSession({
        clientId: 'desktop-1',
        operations: [],
        cursor: inputCursor,
        limit: '10',
        rootId: 123,
        lastReconciledWriteIds: {}
      })
    ).resolves.toMatchObject({
      push: {
        clientId: 'desktop-1'
      },
      pull: {
        json: expect.any(String)
      },
      reconcile: {
        clientId: 'desktop-1'
      }
    });
  });

  it('returns Internal when reconcile upsert returns no row', async () => {
    clientQueryMock.mockReset();
    clientQueryMock
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });

    const inputCursor = encodeVfsSyncCursor({
      changedAt: '2026-03-03T00:00:00.000Z',
      changeId: 'change-1'
    });

    await expect(
      runSession({
        clientId: 'desktop-1',
        operations: [],
        cursor: inputCursor,
        limit: 10,
        lastReconciledWriteIds: {}
      })
    ).rejects.toMatchObject({
      code: Code.Internal
    });
  });

  it('continues when publish notifications fail', async () => {
    applyCrdtPushOperationsMock.mockResolvedValueOnce({
      results: [],
      notifications: [
        {
          containerId: 'item-1',
          changedAt: '2026-03-03T00:00:00.000Z',
          changeId: 'change-1'
        }
      ],
      queryMetrics: {
        totalQueries: 0,
        totalDurationMs: 0,
        perQuery: {}
      }
    });
    publishVfsContainerCursorBumpMock.mockRejectedValueOnce(
      new Error('pubsub unavailable')
    );

    const inputCursor = encodeVfsSyncCursor({
      changedAt: '2026-03-03T00:00:00.000Z',
      changeId: 'change-1'
    });

    await expect(
      runSession({
        clientId: 'desktop-1',
        operations: [],
        cursor: inputCursor,
        limit: 10,
        lastReconciledWriteIds: {}
      })
    ).resolves.toMatchObject({
      push: {
        clientId: 'desktop-1'
      },
      pull: {
        json: expect.any(String)
      },
      reconcile: {
        clientId: 'desktop-1'
      }
    });
  });

  it('preserves ConnectError failures', async () => {
    applyCrdtPushOperationsMock.mockRejectedValueOnce(
      new ConnectError('boom', Code.PermissionDenied)
    );

    const inputCursor = encodeVfsSyncCursor({
      changedAt: '2026-03-03T00:00:00.000Z',
      changeId: 'change-1'
    });

    await expect(
      runSession({
        clientId: 'desktop-1',
        operations: [],
        cursor: inputCursor,
        limit: 10,
        lastReconciledWriteIds: {}
      })
    ).rejects.toMatchObject({
      code: Code.PermissionDenied
    });
  });
});
