import { Code } from '@connectrpc/connect';
import { encodeVfsSyncCursor } from '@tearleads/vfs-sync/vfs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const getPostgresPoolMock = vi.fn();
const getVfsCrdtCompactionEpochMock = vi.fn();
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

import { getCrdtSyncDirect } from './vfsDirectSync.js';

const TEST_USER_ID = '00000000-0000-0000-0000-000000000001';
const TEST_ROOT_ID = '00000000-0000-0000-0000-000000000010';

describe('vfsDirectSync oldest cursor query', () => {
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
  });

  it('loads oldest cursor through effective visibility with raw occurred_at ordering', async () => {
    const cursor = encodeVfsSyncCursor({
      changedAt: '2026-03-03T00:00:01.000Z',
      changeId: '00000000-0000-0000-0000-000000000020'
    });

    queryMock
      .mockResolvedValueOnce({
        rows: [
          {
            occurred_at: '2026-03-03T00:00:00.000Z',
            id: '00000000-0000-0000-0000-000000000010'
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
        rootId: TEST_ROOT_ID
      },
      {
        requestHeader: new Headers()
      }
    );

    const oldestCursorQueryText = queryMock.mock.calls[0]?.[0];
    const oldestCursorQueryValues = queryMock.mock.calls[0]?.[1];

    expect(typeof oldestCursorQueryText).toBe('string');
    expect(oldestCursorQueryText).toContain('FROM vfs_crdt_ops ops');
    expect(oldestCursorQueryText).toContain(
      'INNER JOIN vfs_effective_visibility access'
    );
    expect(oldestCursorQueryText).toContain('access.user_id = $1::uuid');
    expect(oldestCursorQueryText).toContain('ops.item_id = $2::uuid');
    expect(oldestCursorQueryText).toContain('ops.root_id = $2::uuid');
    expect(oldestCursorQueryText).toContain(
      'ORDER BY ops.occurred_at ASC, ops.id ASC'
    );
    expect(oldestCursorQueryText).not.toContain('date_trunc');
    expect(oldestCursorQueryValues).toEqual([TEST_USER_ID, TEST_ROOT_ID]);
  });

  it('uses change id ordering when occurred_at timestamps tie', async () => {
    const cursor = encodeVfsSyncCursor({
      changedAt: '2026-03-03T00:00:00.000Z',
      changeId: '00000000-0000-0000-0000-000000000001'
    });

    queryMock.mockResolvedValueOnce({
      rows: [
        {
          occurred_at: '2026-03-03T00:00:00.000Z',
          id: '00000000-0000-0000-0000-000000000002'
        }
      ]
    });

    await expect(
      getCrdtSyncDirect(
        {
          cursor,
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

    expect(queryMock).toHaveBeenCalledTimes(1);
  });
});
