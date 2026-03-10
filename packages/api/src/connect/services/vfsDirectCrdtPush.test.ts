import { Code, ConnectError } from '@connectrpc/connect';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const applyCrdtPushOperationsMock = vi.fn();
const clientQueryMock = vi.fn();
const clientReleaseMock = vi.fn();
const connectMock = vi.fn();
const getPostgresPoolMock = vi.fn();
const invalidateReplicaWriteIdRowsForUserMock = vi.fn();
const publishVfsContainerCursorBumpMock = vi.fn();
const requireVfsClaimsMock = vi.fn();

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

vi.mock('./vfsDirectCrdtPushApply.js', () => ({
  applyCrdtPushOperations: (...args: unknown[]) =>
    applyCrdtPushOperationsMock(...args)
}));

vi.mock('./vfsDirectAuth.js', () => ({
  requireVfsClaims: (...args: unknown[]) => requireVfsClaimsMock(...args)
}));

import { pushCrdtOpsDirect } from './vfsDirectCrdtPush.js';

let consoleErrorSpy: ReturnType<typeof vi.spyOn> | null = null;

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
      sub: 'user-1',
      organizationId: 'org-1'
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
          organizationId: '',
          clientId: '',
          operations: []
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
        organizationId: 'org-1',
        clientId: 'desktop-1',
        operations: []
      },
      {
        requestHeader: new Headers()
      }
    );

    expect(clientQueryMock).toHaveBeenNthCalledWith(1, 'BEGIN');
    expect(clientQueryMock).toHaveBeenNthCalledWith(2, 'COMMIT');
    expect(requireVfsClaimsMock).toHaveBeenCalledWith(
      '/connect/tearleads.v2.VfsService/PushCrdtOps',
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
    expect(response).toEqual({
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
          organizationId: 'org-1',
          clientId: 'desktop-1',
          operations: []
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
          organizationId: 'org-1',
          clientId: 'desktop-1',
          operations: []
        },
        {
          requestHeader: new Headers()
        }
      )
    ).resolves.toMatchObject({
      clientId: 'desktop-1',
      results: []
    });
  });

  it('preserves ConnectError failures from inner operations', async () => {
    applyCrdtPushOperationsMock.mockRejectedValueOnce(
      new ConnectError('boom', Code.FailedPrecondition)
    );

    await expect(
      pushCrdtOpsDirect(
        {
          organizationId: 'org-1',
          clientId: 'desktop-1',
          operations: []
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
