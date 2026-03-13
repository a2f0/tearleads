import { getCrdtSyncDirect } from './vfsDirectSync.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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

const TEST_ROOT_ID = '00000000-0000-0000-0000-000000000010';
const TEST_USER_ID = '00000000-0000-0000-0000-000000000001';

function toBase64(value: string): string {
  return Buffer.from(value, 'utf8').toString('base64');
}

describe('vfsDirectSync compact root id support', () => {
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

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('accepts rootIdBytes for CRDT sync queries', async () => {
    queryMock.mockResolvedValueOnce({
      rows: []
    });

    await getCrdtSyncDirect(
      {
        cursor: '',
        limit: 10,
        rootId: '',
        rootIdBytes: toBase64(TEST_ROOT_ID)
      },
      {
        requestHeader: new Headers()
      }
    );

    expect(queryMock).toHaveBeenCalledWith(
      expect.any(String),
      expect.arrayContaining([TEST_ROOT_ID])
    );
  });
});
