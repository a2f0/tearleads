import { Code, ConnectError } from '@connectrpc/connect';
import { encodeVfsSyncCursor } from '@tearleads/vfs-sync/vfs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const getPostgresPoolMock = vi.fn();
const getVfsCrdtCompactionEpochMock = vi.fn();
const loadReplicaWriteIdRowsMock = vi.fn();
const loadVfsCrdtRematerializationSnapshotMock = vi.fn();
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

vi.mock('../../lib/vfsCrdtSnapshots.js', () => ({
  loadVfsCrdtRematerializationSnapshot: (...args: unknown[]) =>
    loadVfsCrdtRematerializationSnapshotMock(...args)
}));

vi.mock('./vfsDirectAuth.js', () => ({
  requireVfsClaims: (...args: unknown[]) => requireVfsClaimsMock(...args)
}));

import {
  getCrdtSnapshotDirect,
  getCrdtSyncDirect,
  getSyncDirect
} from './vfsDirectSync.js';

const TEST_USER_ID = '00000000-0000-0000-0000-000000000001';
const TEST_ROOT_ID = '00000000-0000-0000-0000-000000000010';

let consoleErrorSpy: ReturnType<typeof vi.spyOn> | null = null;

describe('vfsDirectSync coverage branches', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    queryMock.mockReset();
    getPostgresPoolMock.mockResolvedValue({
      query: queryMock
    });
    requireVfsClaimsMock.mockResolvedValue({
      sub: TEST_USER_ID
    });
    getVfsCrdtCompactionEpochMock.mockResolvedValue('0');
    readOldestAccessibleCursorCacheMock.mockResolvedValue(undefined);
    writeOldestAccessibleCursorCacheMock.mockResolvedValue(undefined);
    loadReplicaWriteIdRowsMock.mockResolvedValue([]);
    loadVfsCrdtRematerializationSnapshotMock.mockResolvedValue({
      snapshot: {}
    });

    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleErrorSpy?.mockRestore();
    consoleErrorSpy = null;
  });

  it('handles cache misses with no oldest cursor rows', async () => {
    const cursor = encodeVfsSyncCursor({
      changedAt: '2026-03-03T00:00:00.000Z',
      changeId: 'change-1'
    });
    queryMock
      .mockResolvedValueOnce({
        rows: []
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
      compactionEpoch: '0',
      userId: TEST_USER_ID,
      rootId: null,
      cursor: null
    });
  });

  it('drops invalid oldest cursor timestamps before continuing', async () => {
    const cursor = encodeVfsSyncCursor({
      changedAt: '2026-03-03T00:00:00.000Z',
      changeId: 'change-1'
    });
    queryMock
      .mockResolvedValueOnce({
        rows: [
          {
            occurred_at: 'not-a-timestamp',
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
      compactionEpoch: '0',
      userId: TEST_USER_ID,
      rootId: null,
      cursor: null
    });
  });

  it('drops oldest cursor rows with blank change ids', async () => {
    const cursor = encodeVfsSyncCursor({
      changedAt: '2026-03-03T00:00:00.000Z',
      changeId: 'change-1'
    });
    queryMock
      .mockResolvedValueOnce({
        rows: [
          {
            occurred_at: new Date('2026-03-03T00:00:00.000Z'),
            id: '   '
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
      compactionEpoch: '0',
      userId: TEST_USER_ID,
      rootId: null,
      cursor: null
    });
  });

  it('accepts newer cursors when oldest cache exists', async () => {
    const cursor = encodeVfsSyncCursor({
      changedAt: '2026-03-03T00:00:02.000Z',
      changeId: 'change-3'
    });
    readOldestAccessibleCursorCacheMock.mockResolvedValueOnce({
      changedAt: '2026-03-03T00:00:00.000Z',
      changeId: 'change-1'
    });
    queryMock.mockResolvedValueOnce({
      rows: []
    });

    await getCrdtSyncDirect(
      {
        cursor,
        limit: 10,
        rootId: TEST_ROOT_ID
      },
      {
        requestHeader: new Headers()
      }
    );

    expect(readOldestAccessibleCursorCacheMock).toHaveBeenCalledWith({
      compactionEpoch: '0',
      userId: TEST_USER_ID,
      rootId: TEST_ROOT_ID
    });
    expect(writeOldestAccessibleCursorCacheMock).not.toHaveBeenCalled();
  });

  it('rethrows connect errors in getSyncDirect', async () => {
    queryMock.mockRejectedValueOnce(
      new ConnectError('already mapped', Code.FailedPrecondition)
    );

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
      code: Code.FailedPrecondition
    });
  });

  it('maps non-connect snapshot errors to Internal', async () => {
    loadVfsCrdtRematerializationSnapshotMock.mockRejectedValueOnce(
      new Error('snapshot store unavailable')
    );

    await expect(
      getCrdtSnapshotDirect(
        {
          clientId: 'desktop-1'
        },
        {
          requestHeader: new Headers()
        }
      )
    ).rejects.toMatchObject({
      code: Code.Internal
    });
  });

  it('rejects blank snapshot client ids', async () => {
    await expect(
      getCrdtSnapshotDirect(
        {
          clientId: '   '
        },
        {
          requestHeader: new Headers()
        }
      )
    ).rejects.toMatchObject({
      code: Code.InvalidArgument
    });
  });
});
