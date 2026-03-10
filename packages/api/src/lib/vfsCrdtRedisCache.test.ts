import { setTestEnv } from '../test/env.js';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  bumpVfsCrdtCompactionEpoch,
  getVfsCrdtCompactionEpoch,
  invalidateReplicaWriteIdRowsCache,
  readOldestAccessibleCursorCache,
  readReplicaWriteIdRowsCache,
  writeOldestAccessibleCursorCache,
  writeReplicaWriteIdRowsCache
} from './vfsCrdtRedisCache.js';

const redisStore = new Map<string, string>();
const mockRedisClient = {
  get: vi.fn((key: string) => Promise.resolve(redisStore.get(key) ?? null)),
  set: vi.fn((key: string, value: string, _options?: { EX?: number }) => {
    redisStore.set(key, value);
    return Promise.resolve('OK');
  }),
  del: vi.fn((key: string) => {
    const existed = redisStore.delete(key);
    return Promise.resolve(existed ? 1 : 0);
  })
};

vi.mock('@tearleads/shared/redis', () => ({
  getRedisClient: () => Promise.resolve(mockRedisClient)
}));

describe('vfsCrdtRedisCache', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    redisStore.clear();
  });

  it('returns normalized compaction epoch and defaults invalid values to zero', async () => {
    redisStore.set('vfs:crdt:compactionEpoch', '00042');
    expect(await getVfsCrdtCompactionEpoch()).toBe('42');

    redisStore.set('vfs:crdt:compactionEpoch', 'not-a-number');
    expect(await getVfsCrdtCompactionEpoch()).toBe('0');
  });

  it('bumps compaction epoch and persists incremented values', async () => {
    expect(await bumpVfsCrdtCompactionEpoch()).toBe(true);
    expect(redisStore.get('vfs:crdt:compactionEpoch')).toBe('1');

    expect(await bumpVfsCrdtCompactionEpoch()).toBe(true);
    expect(redisStore.get('vfs:crdt:compactionEpoch')).toBe('2');
  });

  it('reads and writes oldest accessible cursor cache entries', async () => {
    await writeOldestAccessibleCursorCache({
      compactionEpoch: '3',
      userId: 'user-1',
      rootId: null,
      cursor: {
        changedAt: '2026-02-24T12:00:00.000Z',
        changeId: 'crdt:500'
      }
    });

    const cachedCursor = await readOldestAccessibleCursorCache({
      compactionEpoch: '3',
      userId: 'user-1',
      rootId: null
    });
    expect(cachedCursor).toEqual({
      changedAt: '2026-02-24T12:00:00.000Z',
      changeId: 'crdt:500'
    });

    await writeOldestAccessibleCursorCache({
      compactionEpoch: '3',
      userId: 'user-1',
      rootId: null,
      cursor: null
    });

    const cachedNullCursor = await readOldestAccessibleCursorCache({
      compactionEpoch: '3',
      userId: 'user-1',
      rootId: null
    });
    expect(cachedNullCursor).toBeNull();
  });

  it('returns undefined for malformed oldest-cursor cache payloads', async () => {
    redisStore.set('vfs:crdt:oldestCursor:4:user-1:*', '{bad-json');
    expect(
      await readOldestAccessibleCursorCache({
        compactionEpoch: '4',
        userId: 'user-1',
        rootId: null
      })
    ).toBeUndefined();

    redisStore.set(
      'vfs:crdt:oldestCursor:4:user-1:*',
      JSON.stringify({ cursor: { changedAt: 'not-a-date', changeId: '' } })
    );
    expect(
      await readOldestAccessibleCursorCache({
        compactionEpoch: '4',
        userId: 'user-1',
        rootId: null
      })
    ).toBeUndefined();
  });

  it('reads and writes replica write-id cache rows', async () => {
    await writeReplicaWriteIdRowsCache({
      userId: 'user-1',
      rows: [
        { replica_id: 'desktop', max_write_id: '7' },
        { replica_id: 'mobile', max_write_id: 4 }
      ]
    });

    const headsRows = await readReplicaWriteIdRowsCache({ userId: 'user-1' });

    expect(headsRows).toEqual([
      { replica_id: 'desktop', max_write_id: '7' },
      { replica_id: 'mobile', max_write_id: 4 }
    ]);

    await invalidateReplicaWriteIdRowsCache('user-1');

    expect(
      await readReplicaWriteIdRowsCache({ userId: 'user-1' })
    ).toBeUndefined();
  });

  it('falls back gracefully when redis reads fail', async () => {
    mockRedisClient.get.mockRejectedValueOnce(new Error('redis read failure'));
    expect(
      await readReplicaWriteIdRowsCache({ userId: 'user-1' })
    ).toBeUndefined();

    mockRedisClient.get.mockRejectedValueOnce(new Error('redis read failure'));
    expect(
      await readOldestAccessibleCursorCache({
        compactionEpoch: '1',
        userId: 'user-1',
        rootId: null
      })
    ).toBeUndefined();
  });

  it('uses default TTLs when cache TTL env vars are invalid', async () => {
    setTestEnv('VFS_CRDT_OLDEST_CURSOR_CACHE_TTL_SECONDS', '0');
    setTestEnv('VFS_CRDT_REPLICA_WRITE_IDS_CACHE_TTL_SECONDS', 'bad-value');

    await writeOldestAccessibleCursorCache({
      compactionEpoch: '1',
      userId: 'user-1',
      rootId: 'root-1',
      cursor: {
        changedAt: '2026-02-24T12:00:00.000Z',
        changeId: 'crdt:500'
      }
    });
    await writeReplicaWriteIdRowsCache({
      userId: 'user-1',
      rows: [{ replica_id: 'desktop', max_write_id: '9' }]
    });

    expect(mockRedisClient.set.mock.calls[0]?.[2]).toEqual({ EX: 30 });
    expect(mockRedisClient.set.mock.calls[1]?.[2]).toEqual({ EX: 15 });
  });
});
