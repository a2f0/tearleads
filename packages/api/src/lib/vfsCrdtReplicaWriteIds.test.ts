import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  invalidateReplicaWriteIdRowsForUser,
  loadReplicaWriteIdRows
} from './vfsCrdtReplicaWriteIds.js';

const redisStore = new Map<string, string>();
const mockRedisClient = {
  get: vi.fn((key: string) => Promise.resolve(redisStore.get(key) ?? null)),
  set: vi.fn((key: string, value: string) => {
    redisStore.set(key, value);
    return Promise.resolve('OK');
  }),
  del: vi.fn((key: string) => {
    redisStore.delete(key);
    return Promise.resolve(1);
  })
};

vi.mock('@tearleads/shared/redis', () => ({
  getRedisClient: () => Promise.resolve(mockRedisClient)
}));

describe('vfsCrdtReplicaWriteIds', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    redisStore.clear();
  });

  it('reads from replica heads table by default', async () => {
    const query = vi.fn().mockResolvedValue({
      rows: [{ replica_id: 'desktop', max_write_id: '4' }]
    });

    const rows = await loadReplicaWriteIdRows({ query }, 'user-1');

    expect(rows).toEqual([{ replica_id: 'desktop', max_write_id: '4' }]);
    expect(query).toHaveBeenCalledTimes(1);
    expect(String(query.mock.calls[0]?.[0])).toContain(
      'FROM vfs_crdt_replica_heads'
    );
    expect(query.mock.calls[0]?.[1]).toEqual(['user-1']);
  });

  it('reuses cached replica write ids on subsequent reads', async () => {
    const query = vi.fn().mockResolvedValue({
      rows: [{ replica_id: 'desktop', max_write_id: '7' }]
    });

    const firstRows = await loadReplicaWriteIdRows({ query }, 'user-1');
    const secondRows = await loadReplicaWriteIdRows({ query }, 'user-1');

    expect(firstRows).toEqual([{ replica_id: 'desktop', max_write_id: '7' }]);
    expect(secondRows).toEqual([{ replica_id: 'desktop', max_write_id: '7' }]);
    expect(query).toHaveBeenCalledTimes(1);
  });

  it('invalidates replica write-id cache entries', async () => {
    redisStore.set(
      'vfs:crdt:replicaWriteIds:heads:user-1',
      JSON.stringify([{ replica_id: 'desktop', max_write_id: '8' }])
    );

    await invalidateReplicaWriteIdRowsForUser('user-1');

    expect(redisStore.has('vfs:crdt:replicaWriteIds:heads:user-1')).toBe(false);
  });
});
