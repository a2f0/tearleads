import { Code, ConnectError } from '@connectrpc/connect';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const {
  applyCrdtPushOperationsMock,
  clientQueryMock,
  clientReleaseMock,
  connectMock,
  getPostgresPoolMock,
  invalidateReplicaWriteIdRowsForUserMock,
  publishVfsContainerCursorBumpMock,
  requireVfsClaimsMock
} = vi.hoisted(() => ({
  applyCrdtPushOperationsMock: vi.fn(),
  clientQueryMock: vi.fn(),
  clientReleaseMock: vi.fn(),
  connectMock: vi.fn(),
  getPostgresPoolMock: vi.fn(),
  invalidateReplicaWriteIdRowsForUserMock: vi.fn(),
  publishVfsContainerCursorBumpMock: vi.fn(),
  requireVfsClaimsMock: vi.fn()
}));

vi.mock('../../lib/postgres.js', () => ({
  getPostgresPool: (...args: unknown[]) => getPostgresPoolMock(...args)
}));

vi.mock('../../lib/vfsCrdtReplicaWriteIds.js', () => ({
  invalidateReplicaWriteIdRowsForUser: (...args: unknown[]) =>
    invalidateReplicaWriteIdRowsForUserMock(...args)
}));

vi.mock('../../lib/vfsSyncChannels.js', () => ({
  publishVfsContainerCursorBump: (...args: unknown[]) =>
    publishVfsContainerCursorBumpMock(...args)
}));

vi.mock('../../routes/vfs/crdtPushApply.js', () => ({
  applyCrdtPushOperations: (...args: unknown[]) =>
    applyCrdtPushOperationsMock(...args)
}));

vi.mock('./vfsDirectAuth.js', () => ({
  requireVfsClaims: (...args: unknown[]) => requireVfsClaimsMock(...args)
}));

import { pushCrdtOpsDirect } from './vfsDirectCrdtPush.js';

let consoleErrorSpy: ReturnType<typeof vi.spyOn> | null = null;

function parseJson(json: string): unknown {
  return JSON.parse(json);
}

describe('vfsDirectCrdtPush', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    clientQueryMock.mockReset();
    clientReleaseMock.mockReset();
    connectMock.mockReset();
    getPostgresPoolMock.mockReset();
    invalidateReplicaWriteIdRowsForUserMock.mockReset();
    publishVfsContainerCursorBumpMock.mockReset();
    requireVfsClaimsMock.mockReset();
    applyCrdtPushOperationsMock.mockReset();

    connectMock.mockResolvedValue({
      query: clientQueryMock,
      release: clientReleaseMock
    });
    getPostgresPoolMock.mockResolvedValue({
      connect: connectMock
    });
    requireVfsClaimsMock.mockResolvedValue({
      sub: 'user-1'
    });

    clientQueryMock
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });

    applyCrdtPushOperationsMock.mockResolvedValue({
      results: [],
      notifications: [],
      queryMetrics: {
        totalQueries: 0,
        totalDurationMs: 0,
        perQuery: {}
      }
    });

    invalidateReplicaWriteIdRowsForUserMock.mockResolvedValue(undefined);
    publishVfsContainerCursorBumpMock.mockResolvedValue(undefined);

    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleErrorSpy?.mockRestore();
    consoleErrorSpy = null;
  });

  it('rejects invalid push payloads', async () => {
    await expect(
      pushCrdtOpsDirect(
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

    expect(connectMock).not.toHaveBeenCalled();
  });

  it('applies push operations and returns response payload', async () => {
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

    const response = await pushCrdtOpsDirect(
      {
        json: JSON.stringify({
          clientId: 'desktop-1',
          operations: []
        })
      },
      {
        requestHeader: new Headers()
      }
    );

    expect(clientQueryMock).toHaveBeenNthCalledWith(1, 'BEGIN');
    expect(clientQueryMock).toHaveBeenNthCalledWith(2, 'COMMIT');
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
    expect(parseJson(response.json)).toEqual({
      clientId: 'desktop-1',
      results: [
        {
          opId: 'op-1',
          status: 'applied'
        }
      ]
    });
    expect(clientReleaseMock).toHaveBeenCalled();
  });

  it('rolls back and maps failures to Internal', async () => {
    applyCrdtPushOperationsMock.mockRejectedValueOnce(new Error('db failed'));

    await expect(
      pushCrdtOpsDirect(
        {
          json: JSON.stringify({
            clientId: 'desktop-1',
            operations: []
          })
        },
        {
          requestHeader: new Headers()
        }
      )
    ).rejects.toMatchObject({
      code: Code.Internal
    });

    expect(clientQueryMock).toHaveBeenNthCalledWith(1, 'BEGIN');
    expect(clientQueryMock).toHaveBeenNthCalledWith(2, 'ROLLBACK');
    expect(clientReleaseMock).toHaveBeenCalled();
  });

  it('continues when notification publish fails', async () => {
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
      new Error('publish down')
    );

    await expect(
      pushCrdtOpsDirect(
        {
          json: JSON.stringify({
            clientId: 'desktop-1',
            operations: []
          })
        },
        {
          requestHeader: new Headers()
        }
      )
    ).resolves.toMatchObject({
      json: expect.any(String)
    });
  });

  it('preserves ConnectError failures from inner operations', async () => {
    applyCrdtPushOperationsMock.mockRejectedValueOnce(
      new ConnectError('boom', Code.FailedPrecondition)
    );

    await expect(
      pushCrdtOpsDirect(
        {
          json: JSON.stringify({
            clientId: 'desktop-1',
            operations: []
          })
        },
        {
          requestHeader: new Headers()
        }
      )
    ).rejects.toMatchObject({
      code: Code.FailedPrecondition
    });
  });
});
