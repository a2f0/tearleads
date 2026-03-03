import { Code } from '@connectrpc/connect';
import { encodeVfsSyncCursor } from '@tearleads/vfs-sync/vfs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const {
  getVfsCrdtCompactionEpochMock,
  getPostgresPoolMock,
  loadVfsCrdtRematerializationSnapshotMock,
  loadReplicaWriteIdRowsMock,
  queryMock,
  readOldestAccessibleCursorCacheMock,
  requireVfsClaimsMock,
  shouldReadEnvelopeByteaMock,
  writeOldestAccessibleCursorCacheMock
} = vi.hoisted(() => ({
  getVfsCrdtCompactionEpochMock: vi.fn(),
  getPostgresPoolMock: vi.fn(),
  loadVfsCrdtRematerializationSnapshotMock: vi.fn(),
  loadReplicaWriteIdRowsMock: vi.fn(),
  queryMock: vi.fn(),
  readOldestAccessibleCursorCacheMock: vi.fn(),
  requireVfsClaimsMock: vi.fn(),
  shouldReadEnvelopeByteaMock: vi.fn(),
  writeOldestAccessibleCursorCacheMock: vi.fn()
}));
vi.mock('../../lib/postgres.js', () => ({
  getPostgresPool: (...args: unknown[]) => getPostgresPoolMock(...args)
}));
vi.mock('../../lib/vfsCrdtSnapshots.js', () => ({
  loadVfsCrdtRematerializationSnapshot: (...args: unknown[]) =>
    loadVfsCrdtRematerializationSnapshotMock(...args)
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
vi.mock('./vfsDirectCrdtEnvelopeReadOptions.js', () => ({
  shouldReadEnvelopeBytea: (...args: unknown[]) =>
    shouldReadEnvelopeByteaMock(...args)
}));
vi.mock('./vfsDirectAuth.js', () => ({
  requireVfsClaims: (...args: unknown[]) => requireVfsClaimsMock(...args)
}));

import {
  getCrdtSnapshotDirect,
  getCrdtSyncDirect,
  getSyncDirect,
  reconcileSyncDirect
} from './vfsDirectSync.js';

let consoleErrorSpy: ReturnType<typeof vi.spyOn> | null = null;

function parseJson(json: string): unknown {
  return JSON.parse(json);
}

describe('vfsDirectSync', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    queryMock.mockReset();
    requireVfsClaimsMock.mockReset();
    loadVfsCrdtRematerializationSnapshotMock.mockReset();
    getVfsCrdtCompactionEpochMock.mockReset();
    readOldestAccessibleCursorCacheMock.mockReset();
    writeOldestAccessibleCursorCacheMock.mockReset();
    loadReplicaWriteIdRowsMock.mockReset();
    shouldReadEnvelopeByteaMock.mockReset();

    getPostgresPoolMock.mockResolvedValue({
      query: queryMock
    });
    requireVfsClaimsMock.mockResolvedValue({
      sub: 'user-1'
    });
    getVfsCrdtCompactionEpochMock.mockResolvedValue('0');
    readOldestAccessibleCursorCacheMock.mockResolvedValue(undefined);
    writeOldestAccessibleCursorCacheMock.mockResolvedValue(undefined);
    loadReplicaWriteIdRowsMock.mockResolvedValue([]);
    shouldReadEnvelopeByteaMock.mockReturnValue(false);

    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleErrorSpy?.mockRestore();
    consoleErrorSpy = null;
  });

  it('rejects getSync when query params are invalid', async () => {
    await expect(
      getSyncDirect(
        {
          cursor: 'not-a-valid-cursor',
          limit: 10,
          rootId: ''
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

  it('returns sync payload from mapped query rows', async () => {
    queryMock.mockResolvedValueOnce({
      rows: []
    });

    const response = await getSyncDirect(
      {
        cursor: '',
        limit: 10,
        rootId: ''
      },
      {
        requestHeader: new Headers()
      }
    );

    expect(parseJson(response.json)).toEqual({
      items: [],
      nextCursor: null,
      hasMore: false
    });
  });

  it('maps getSync query failures to Internal', async () => {
    queryMock.mockRejectedValueOnce(new Error('db unavailable'));

    await expect(
      getSyncDirect(
        {
          cursor: '',
          limit: 10,
          rootId: ''
        },
        {
          requestHeader: new Headers()
        }
      )
    ).rejects.toMatchObject({
      code: Code.Internal
    });
  });

  it('normalizes empty getSync values before parsing', async () => {
    queryMock.mockResolvedValueOnce({
      rows: []
    });

    const response = await getSyncDirect(
      {
        cursor: ' ',
        limit: -10,
        rootId: ' '
      },
      {
        requestHeader: new Headers()
      }
    );

    expect(parseJson(response.json)).toEqual({
      items: [],
      nextCursor: null,
      hasMore: false
    });
  });

  it('rejects getCrdtSync when query params are invalid', async () => {
    await expect(
      getCrdtSyncDirect(
        {
          cursor: 'not-a-valid-cursor',
          limit: 10,
          rootId: ''
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

  it('returns CRDT sync payload rows with lastReconciledWriteIds', async () => {
    queryMock.mockResolvedValueOnce({
      rows: []
    });
    loadReplicaWriteIdRowsMock.mockResolvedValueOnce([
      {
        replica_id: 'desktop',
        max_write_id: 5
      }
    ]);

    const response = await getCrdtSyncDirect(
      {
        cursor: '',
        limit: 10,
        rootId: ''
      },
      {
        requestHeader: new Headers()
      }
    );

    expect(parseJson(response.json)).toEqual({
      items: [],
      nextCursor: null,
      hasMore: false,
      lastReconciledWriteIds: {
        desktop: 5
      }
    });
  });

  it('returns AlreadyExists when CRDT cursor is stale', async () => {
    const staleCursor = encodeVfsSyncCursor({
      changedAt: '2026-03-03T00:00:00.000Z',
      changeId: 'change-1'
    });
    readOldestAccessibleCursorCacheMock.mockResolvedValueOnce({
      changedAt: '2026-03-03T00:00:01.000Z',
      changeId: 'change-2'
    });

    await expect(
      getCrdtSyncDirect(
        {
          cursor: staleCursor,
          limit: 10,
          rootId: ''
        },
        {
          requestHeader: new Headers()
        }
      )
    ).rejects.toMatchObject({
      code: Code.AlreadyExists
    });

    expect(queryMock).not.toHaveBeenCalled();
    expect(writeOldestAccessibleCursorCacheMock).not.toHaveBeenCalled();
  });

  it('writes oldest cursor cache after cache miss during CRDT sync', async () => {
    const cursor = encodeVfsSyncCursor({
      changedAt: '2026-03-03T00:00:00.000Z',
      changeId: 'change-1'
    });
    getVfsCrdtCompactionEpochMock.mockResolvedValueOnce('4');
    queryMock
      .mockResolvedValueOnce({
        rows: [
          {
            occurred_at: '2026-03-03T00:00:00.000Z',
            id: 'change-1'
          }
        ]
      })
      .mockResolvedValueOnce({
        rows: []
      });

    await getCrdtSyncDirect(
      {
        cursor,
        limit: 10,
        rootId: ''
      },
      {
        requestHeader: new Headers()
      }
    );

    expect(writeOldestAccessibleCursorCacheMock).toHaveBeenCalledWith({
      compactionEpoch: '4',
      userId: 'user-1',
      rootId: null,
      cursor: {
        changedAt: '2026-03-03T00:00:00.000Z',
        changeId: 'change-1'
      }
    });
  });

  it('maps getCrdtSync query failures to Internal', async () => {
    queryMock.mockRejectedValueOnce(new Error('db unavailable'));

    await expect(
      getCrdtSyncDirect(
        {
          cursor: '',
          limit: 10,
          rootId: ''
        },
        {
          requestHeader: new Headers()
        }
      )
    ).rejects.toMatchObject({
      code: Code.Internal
    });
  });

  it('rejects getCrdtSnapshot when clientId is invalid', async () => {
    await expect(
      getCrdtSnapshotDirect(
        {
          clientId: 'bad:client'
        },
        {
          requestHeader: new Headers()
        }
      )
    ).rejects.toMatchObject({
      code: Code.InvalidArgument
    });
  });

  it('returns NotFound when no CRDT snapshot exists', async () => {
    loadVfsCrdtRematerializationSnapshotMock.mockResolvedValueOnce(null);

    await expect(
      getCrdtSnapshotDirect(
        {
          clientId: 'client-1'
        },
        {
          requestHeader: new Headers()
        }
      )
    ).rejects.toMatchObject({
      code: Code.NotFound
    });
  });

  it('returns snapshot payload when one exists', async () => {
    loadVfsCrdtRematerializationSnapshotMock.mockResolvedValueOnce({
      snapshot: 'payload'
    });

    const response = await getCrdtSnapshotDirect(
      {
        clientId: 'client-1'
      },
      {
        requestHeader: new Headers()
      }
    );

    expect(parseJson(response.json)).toEqual({
      snapshot: 'payload'
    });
  });

  it('rejects reconcileSync when payload is invalid', async () => {
    await expect(
      reconcileSyncDirect(
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

  it('rejects reconcileSync when clientId contains a colon', async () => {
    const cursor = encodeVfsSyncCursor({
      changedAt: '2026-03-03T00:00:00.000Z',
      changeId: 'change-1'
    });

    await expect(
      reconcileSyncDirect(
        {
          json: JSON.stringify({
            clientId: 'bad:client',
            cursor
          })
        },
        {
          requestHeader: new Headers()
        }
      )
    ).rejects.toMatchObject({
      code: Code.InvalidArgument
    });
  });

  it('returns Internal when reconcile does not return row data', async () => {
    queryMock.mockResolvedValueOnce({
      rows: []
    });
    const inputCursor = encodeVfsSyncCursor({
      changedAt: '2026-03-03T00:00:00.000Z',
      changeId: 'change-1'
    });

    await expect(
      reconcileSyncDirect(
        {
          json: JSON.stringify({
            clientId: 'client-1',
            cursor: inputCursor
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

  it('stores reconcile cursor and returns encoded cursor', async () => {
    queryMock.mockResolvedValueOnce({
      rows: [
        {
          last_reconciled_at: new Date('2026-03-03T00:00:00.000Z'),
          last_reconciled_change_id: 'change-2'
        }
      ]
    });

    const inputCursor = encodeVfsSyncCursor({
      changedAt: '2026-03-03T00:00:00.000Z',
      changeId: 'change-1'
    });

    const response = await reconcileSyncDirect(
      {
        json: JSON.stringify({
          clientId: 'client-1',
          cursor: inputCursor
        })
      },
      {
        requestHeader: new Headers()
      }
    );

    expect(parseJson(response.json)).toEqual({
      clientId: 'client-1',
      cursor: encodeVfsSyncCursor({
        changedAt: '2026-03-03T00:00:00.000Z',
        changeId: 'change-2'
      })
    });
  });

  it('maps reconcile query failures to Internal', async () => {
    queryMock.mockRejectedValueOnce(new Error('db write failed'));
    const inputCursor = encodeVfsSyncCursor({
      changedAt: '2026-03-03T00:00:00.000Z',
      changeId: 'change-1'
    });

    await expect(
      reconcileSyncDirect(
        {
          json: JSON.stringify({
            clientId: 'client-1',
            cursor: inputCursor
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
});
