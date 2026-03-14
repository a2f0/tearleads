import { Code } from '@connectrpc/connect';
import { encodeVfsSyncCursor } from '@tearleads/vfs-sync/vfs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const getVfsCrdtCompactionEpochMock = vi.fn();
const getPostgresPoolMock = vi.fn();
const loadReplicaWriteIdRowsMock = vi.fn();
const queryMock = vi.fn();
const readOldestAccessibleCursorCacheMock = vi.fn();
const requireVfsClaimsMock = vi.fn();
const writeOldestAccessibleCursorCacheMock = vi.fn();

vi.mock('../../lib/postgres.js', () => ({
  getPostgresPool: (...args: unknown[]) => getPostgresPoolMock(...args)
}));
vi.mock('../../lib/vfsCrdtRedisCache.js', () => ({
  getVfsCrdtCompactionEpoch: (...args: unknown[]) =>
    getVfsCrdtCompactionEpochMock(...args),
  readOldestAccessibleCursorCache: (...args: unknown[]) =>
    readOldestAccessibleCursorCacheMock(...args),
  writeOldestAccessibleCursorCache: (...args: unknown[]) =>
    writeOldestAccessibleCursorCacheMock(...args)
}));
vi.mock('../../lib/vfsCrdtReplicaWriteIds.js', () => ({
  loadReplicaWriteIdRows: (...args: unknown[]) =>
    loadReplicaWriteIdRowsMock(...args)
}));
vi.mock('./vfsDirectAuth.js', () => ({
  requireVfsClaims: (...args: unknown[]) => requireVfsClaimsMock(...args)
}));

import { getCrdtSyncDirect, getSyncDirect } from './vfsDirectSync.js';

let consoleErrorSpy: ReturnType<typeof vi.spyOn> | null = null;
const CHANGE_ID_1 = '00000000-0000-0000-0000-000000000001';
const CHANGE_ID_2 = '00000000-0000-0000-0000-000000000002';

describe('vfsDirectSync core', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    queryMock.mockReset();
    requireVfsClaimsMock.mockReset();
    getVfsCrdtCompactionEpochMock.mockReset();
    readOldestAccessibleCursorCacheMock.mockReset();
    writeOldestAccessibleCursorCacheMock.mockReset();
    loadReplicaWriteIdRowsMock.mockReset();

    getPostgresPoolMock.mockResolvedValue({
      query: queryMock
    });
    requireVfsClaimsMock.mockResolvedValue({
      sub: '00000000-0000-0000-0000-000000000001'
    });
    getVfsCrdtCompactionEpochMock.mockResolvedValue('0');
    readOldestAccessibleCursorCacheMock.mockResolvedValue(undefined);
    writeOldestAccessibleCursorCacheMock.mockResolvedValue(undefined);
    loadReplicaWriteIdRowsMock.mockResolvedValue([]);

    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleErrorSpy?.mockRestore();
    consoleErrorSpy = null;
  });

  it('rejects getSync when query params are invalid', async () => {
    await expect(
      getSyncDirect(
        { cursor: 'not-a-valid-cursor', limit: 10, rootId: '' },
        { requestHeader: new Headers() }
      )
    ).rejects.toMatchObject({ code: Code.InvalidArgument });
  });

  it('returns sync payload from mapped query rows', async () => {
    queryMock.mockResolvedValueOnce({ rows: [] });
    const response = await getSyncDirect(
      { cursor: '', limit: 10, rootId: '' },
      { requestHeader: new Headers() }
    );
    expect(response).toEqual({ items: [], hasMore: false });
  });

  it('correctly handles real UUIDs for userId and rootId', async () => {
    const realUserId = '00000000-0000-0000-0000-000000000001';
    const realRootId = '00000000-0000-0000-0000-000000000002';
    requireVfsClaimsMock.mockResolvedValue({ sub: realUserId });
    queryMock.mockResolvedValueOnce({ rows: [] });

    const response = await getSyncDirect(
      { cursor: '', limit: 10, rootId: realRootId },
      { requestHeader: new Headers() }
    );

    expect(response).toEqual({ items: [], hasMore: false });
    expect(queryMock).toHaveBeenCalled();
  });

  it('maps getSync query failures to Internal', async () => {
    queryMock.mockRejectedValueOnce(new Error('db unavailable'));
    await expect(
      getSyncDirect(
        { cursor: '', limit: 10, rootId: '' },
        { requestHeader: new Headers() }
      )
    ).rejects.toMatchObject({ code: Code.Internal });
  });

  it('rejects getCrdtSync when query params are invalid', async () => {
    await expect(
      getCrdtSyncDirect(
        { cursor: 'not-a-valid-cursor', limit: 10, rootId: '' },
        { requestHeader: new Headers() }
      )
    ).rejects.toMatchObject({ code: Code.InvalidArgument });
  });

  it('returns CRDT sync payload rows with lastReconciledWriteIds', async () => {
    queryMock.mockResolvedValueOnce({ rows: [] });
    loadReplicaWriteIdRowsMock.mockResolvedValueOnce([
      { replica_id: 'desktop', max_write_id: 5 }
    ]);

    const response = await getCrdtSyncDirect(
      { cursor: '', limit: 10, rootId: '' },
      { requestHeader: new Headers() }
    );

    expect(response).toEqual({
      items: [],
      hasMore: false,
      lastReconciledWriteIds: { desktop: 5 }
    });
  });

  it('correctly handles real UUIDs for getCrdtSync', async () => {
    const realUserId = '00000000-0000-0000-0000-000000000001';
    const realRootId = '00000000-0000-0000-0000-000000000002';
    requireVfsClaimsMock.mockResolvedValue({ sub: realUserId });
    queryMock.mockResolvedValueOnce({ rows: [] });
    loadReplicaWriteIdRowsMock.mockResolvedValueOnce([]);

    const response = await getCrdtSyncDirect(
      { cursor: '', limit: 10, rootId: realRootId },
      { requestHeader: new Headers() }
    );

    expect(response).toEqual({
      items: [],
      hasMore: false,
      lastReconciledWriteIds: {}
    });
    expect(queryMock).toHaveBeenCalled();
  });

  it('returns AlreadyExists when CRDT cursor is stale', async () => {
    const staleCursor = encodeVfsSyncCursor({
      changedAt: '2026-03-03T00:00:00.000Z',
      changeId: CHANGE_ID_1
    });
    readOldestAccessibleCursorCacheMock.mockResolvedValueOnce({
      changedAt: '2026-03-03T00:00:01.000Z',
      changeId: CHANGE_ID_2
    });

    await expect(
      getCrdtSyncDirect(
        { cursor: staleCursor, limit: 10, rootId: '' },
        { requestHeader: new Headers() }
      )
    ).rejects.toMatchObject({ code: Code.AlreadyExists });
  });

  it('writes oldest cursor cache after cache miss during CRDT sync', async () => {
    const cursor = encodeVfsSyncCursor({
      changedAt: '2026-03-03T00:00:00.000Z',
      changeId: CHANGE_ID_1
    });
    getVfsCrdtCompactionEpochMock.mockResolvedValueOnce('4');
    queryMock
      .mockResolvedValueOnce({
        rows: [{ occurred_at: '2026-03-03T00:00:00.000Z', id: CHANGE_ID_1 }]
      })
      .mockResolvedValueOnce({ rows: [] });

    await getCrdtSyncDirect(
      { cursor, limit: 10, rootId: '' },
      { requestHeader: new Headers() }
    );

    expect(writeOldestAccessibleCursorCacheMock).toHaveBeenCalled();
  });
});
