import { Code, ConnectError } from '@connectrpc/connect';
import { encodeVfsSyncCursor } from '@tearleads/vfs-sync/vfs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const {
  getPostgresPoolMock,
  getVfsCrdtCompactionEpochMock,
  loadReplicaWriteIdRowsMock,
  loadVfsCrdtRematerializationSnapshotMock,
  queryMock,
  readOldestAccessibleCursorCacheMock,
  requireVfsClaimsMock,
  shouldReadEnvelopeByteaMock,
  writeOldestAccessibleCursorCacheMock
} = vi.hoisted(() => ({
  getPostgresPoolMock: vi.fn(),
  getVfsCrdtCompactionEpochMock: vi.fn(),
  loadReplicaWriteIdRowsMock: vi.fn(),
  loadVfsCrdtRematerializationSnapshotMock: vi.fn(),
  queryMock: vi.fn(),
  readOldestAccessibleCursorCacheMock: vi.fn(),
  requireVfsClaimsMock: vi.fn(),
  shouldReadEnvelopeByteaMock: vi.fn(),
  writeOldestAccessibleCursorCacheMock: vi.fn()
}));

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

vi.mock('../../routes/vfs/crdtEnvelopeReadOptions.js', () => ({
  shouldReadEnvelopeBytea: (...args: unknown[]) =>
    shouldReadEnvelopeByteaMock(...args)
}));

vi.mock('./vfsDirectAuth.js', () => ({
  requireVfsClaims: (...args: unknown[]) => requireVfsClaimsMock(...args)
}));

import {
  getCrdtSnapshotDirect,
  getCrdtSyncDirect,
  getSyncDirect
} from './vfsDirectSync.js';

let consoleErrorSpy: ReturnType<typeof vi.spyOn> | null = null;

describe('vfsDirectSync coverage branches', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    queryMock.mockReset();
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
    loadVfsCrdtRematerializationSnapshotMock.mockResolvedValue({
      snapshot: {}
    });
    shouldReadEnvelopeByteaMock.mockReturnValue(false);

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
      userId: 'user-1',
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
      userId: 'user-1',
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
      userId: 'user-1',
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
        rootId: 'root-1'
      },
      {
        requestHeader: new Headers()
      }
    );

    expect(readOldestAccessibleCursorCacheMock).toHaveBeenCalledWith({
      compactionEpoch: '0',
      userId: 'user-1',
      rootId: 'root-1'
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
