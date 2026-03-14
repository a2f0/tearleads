import { Code, ConnectError } from '@connectrpc/connect';
import { encodeVfsSyncCursor } from '@tearleads/vfs-sync/vfs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const getPostgresPoolMock = vi.fn();
const loadVfsCrdtRematerializationSnapshotMock = vi.fn();
const queryMock = vi.fn();
const requireVfsClaimsMock = vi.fn();

vi.mock('../../lib/postgres.js', () => ({
  getPostgresPool: (...args: unknown[]) => getPostgresPoolMock(...args)
}));
vi.mock('../../lib/vfsCrdtSnapshots.js', () => ({
  loadVfsCrdtRematerializationSnapshot: (...args: unknown[]) =>
    loadVfsCrdtRematerializationSnapshotMock(...args)
}));
vi.mock('./vfsDirectAuth.js', () => ({
  requireVfsClaims: (...args: unknown[]) => requireVfsClaimsMock(...args)
}));

import { getCrdtSnapshotDirect, reconcileSyncDirect } from './vfsDirectSync.js';

let consoleErrorSpy: ReturnType<typeof vi.spyOn> | null = null;
const CHANGE_ID_1 = '00000000-0000-0000-0000-000000000001';
const CHANGE_ID_2 = '00000000-0000-0000-0000-000000000002';

describe('vfsDirectSync reconcile & snapshots', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    queryMock.mockReset();
    requireVfsClaimsMock.mockReset();
    loadVfsCrdtRematerializationSnapshotMock.mockReset();

    getPostgresPoolMock.mockResolvedValue({
      query: queryMock
    });
    requireVfsClaimsMock.mockResolvedValue({
      sub: '00000000-0000-0000-0000-000000000001'
    });

    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleErrorSpy?.mockRestore();
    consoleErrorSpy = null;
  });

  it('rejects getCrdtSnapshot when clientId is invalid', async () => {
    await expect(
      getCrdtSnapshotDirect(
        { clientId: 'bad:client' },
        { requestHeader: new Headers() }
      )
    ).rejects.toMatchObject({ code: Code.InvalidArgument });
  });

  it('rejects getCrdtSnapshot when clientId is not a string', async () => {
    const invalidRequest = JSON.parse('{"clientId":123}');
    await expect(
      getCrdtSnapshotDirect(invalidRequest, { requestHeader: new Headers() })
    ).rejects.toMatchObject({ code: Code.InvalidArgument });
  });

  it('rejects getCrdtSnapshot when userId claim is invalid', async () => {
    requireVfsClaimsMock.mockResolvedValueOnce({
      sub: 'invalid-user-id'
    });

    await expect(
      getCrdtSnapshotDirect(
        { clientId: 'client-1' },
        { requestHeader: new Headers() }
      )
    ).rejects.toMatchObject({ code: Code.InvalidArgument });
  });

  it('returns NotFound when no CRDT snapshot exists', async () => {
    loadVfsCrdtRematerializationSnapshotMock.mockResolvedValueOnce(null);
    await expect(
      getCrdtSnapshotDirect(
        { clientId: 'client-1' },
        { requestHeader: new Headers() }
      )
    ).rejects.toMatchObject({ code: Code.NotFound });
  });

  it('returns snapshot payload when one exists', async () => {
    loadVfsCrdtRematerializationSnapshotMock.mockResolvedValueOnce({
      replaySnapshot: { acl: [], links: [], cursor: null },
      reconcileState: null,
      containerClocks: [],
      snapshotUpdatedAt: '2026-03-08T00:00:00.000Z'
    });

    const response = await getCrdtSnapshotDirect(
      { clientId: 'client-1' },
      { requestHeader: new Headers() }
    );

    expect(response).toEqual({
      replaySnapshot: { acl: [], links: [] },
      containerClocks: [],
      snapshotUpdatedAt: '2026-03-08T00:00:00.000Z'
    });
  });

  it('rejects reconcileSync when payload is invalid', async () => {
    await expect(
      reconcileSyncDirect(
        { clientId: '', cursor: '' },
        { requestHeader: new Headers() }
      )
    ).rejects.toMatchObject({ code: Code.InvalidArgument });
  });

  it('rejects reconcileSync when clientId contains ":"', async () => {
    await expect(
      reconcileSyncDirect(
        {
          clientId: 'bad:client',
          cursor: encodeVfsSyncCursor({
            changedAt: '2026-03-03T00:00:00.000Z',
            changeId: CHANGE_ID_1
          })
        },
        { requestHeader: new Headers() }
      )
    ).rejects.toMatchObject({ code: Code.InvalidArgument });
  });

  it('rejects reconcileSync when userId claim is invalid', async () => {
    requireVfsClaimsMock.mockResolvedValueOnce({
      sub: 'invalid-user-id'
    });

    await expect(
      reconcileSyncDirect(
        {
          clientId: 'client-1',
          cursor: encodeVfsSyncCursor({
            changedAt: '2026-03-03T00:00:00.000Z',
            changeId: CHANGE_ID_1
          })
        },
        { requestHeader: new Headers() }
      )
    ).rejects.toMatchObject({ code: Code.InvalidArgument });
  });

  it('stores reconcile cursor and returns encoded cursor', async () => {
    queryMock.mockResolvedValueOnce({
      rows: [
        {
          last_reconciled_at: new Date('2026-03-03T00:00:00.000Z'),
          last_reconciled_change_id: CHANGE_ID_2
        }
      ]
    });

    const inputCursor = encodeVfsSyncCursor({
      changedAt: '2026-03-03T00:00:00.000Z',
      changeId: CHANGE_ID_1
    });

    const response = await reconcileSyncDirect(
      { clientId: 'client-1', cursor: inputCursor },
      { requestHeader: new Headers() }
    );

    expect(response).toEqual({
      clientId: 'client-1',
      cursor: encodeVfsSyncCursor({
        changedAt: '2026-03-03T00:00:00.000Z',
        changeId: CHANGE_ID_2
      })
    });
  });

  it('returns Internal when reconcile writeback does not return a cursor', async () => {
    queryMock.mockResolvedValueOnce({
      rows: []
    });

    const inputCursor = encodeVfsSyncCursor({
      changedAt: '2026-03-03T00:00:00.000Z',
      changeId: CHANGE_ID_1
    });

    await expect(
      reconcileSyncDirect(
        { clientId: 'client-1', cursor: inputCursor },
        { requestHeader: new Headers() }
      )
    ).rejects.toMatchObject({ code: Code.Internal });
  });

  it('rethrows connect errors from reconcile storage', async () => {
    queryMock.mockRejectedValueOnce(
      new ConnectError('already mapped', Code.FailedPrecondition)
    );

    const inputCursor = encodeVfsSyncCursor({
      changedAt: '2026-03-03T00:00:00.000Z',
      changeId: CHANGE_ID_1
    });

    await expect(
      reconcileSyncDirect(
        { clientId: 'client-1', cursor: inputCursor },
        { requestHeader: new Headers() }
      )
    ).rejects.toMatchObject({ code: Code.FailedPrecondition });
  });

  it('maps unexpected reconcile storage failures to Internal', async () => {
    queryMock.mockRejectedValueOnce(new Error('db unavailable'));

    const inputCursor = encodeVfsSyncCursor({
      changedAt: '2026-03-03T00:00:00.000Z',
      changeId: CHANGE_ID_1
    });

    await expect(
      reconcileSyncDirect(
        { clientId: 'client-1', cursor: inputCursor },
        { requestHeader: new Headers() }
      )
    ).rejects.toMatchObject({ code: Code.Internal });

    expect(consoleErrorSpy).toHaveBeenCalled();
  });

  it('correctly handles real UUID for reconcileSyncDirect', async () => {
    const realUserId = '00000000-0000-0000-0000-000000000001';
    requireVfsClaimsMock.mockResolvedValue({
      sub: realUserId,
      organizationId: 'org-1'
    });
    queryMock.mockResolvedValueOnce({
      rows: [
        {
          last_reconciled_at: new Date('2026-03-03T00:00:00.000Z'),
          last_reconciled_change_id: CHANGE_ID_2
        }
      ]
    });

    const inputCursor = encodeVfsSyncCursor({
      changedAt: '2026-03-03T00:00:00.000Z',
      changeId: CHANGE_ID_1
    });

    await reconcileSyncDirect(
      { clientId: 'client-1', cursor: inputCursor },
      { requestHeader: new Headers() }
    );

    expect(queryMock).toHaveBeenCalled();
    const queryCall = queryMock.mock.calls[0];
    expect(queryCall).toBeDefined();
    if (!queryCall) {
      throw new Error('expected reconcileSyncDirect to issue a SQL query');
    }
    expect(queryCall[1]).toContain(realUserId);
  });
});
