import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  areReplicaHeadReadsEnabled,
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
    vi.unstubAllEnvs();
    redisStore.clear();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
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

  it('uses legacy CRDT op scan when flag disables replica-head reads', async () => {
    vi.stubEnv('VFS_CRDT_REPLICA_HEADS_READS', 'false');
    const query = vi.fn().mockResolvedValue({
      rows: [{ replica_id: 'desktop', max_write_id: '9' }]
    });

    const rows = await loadReplicaWriteIdRows({ query }, 'user-1');

    expect(rows).toEqual([{ replica_id: 'desktop', max_write_id: '9' }]);
    expect(query).toHaveBeenCalledTimes(1);
    expect(String(query.mock.calls[0]?.[0])).toContain('FROM vfs_crdt_ops');
    expect(String(query.mock.calls[0]?.[0])).toContain('split_part(source_id');
    expect(query.mock.calls[0]?.[1]).toEqual([
      'vfs_crdt_client_push',
      'user-1'
    ]);
  });

  it('invalidates both replica write-id cache modes', async () => {
    redisStore.set(
      'vfs:crdt:replicaWriteIds:heads:user-1',
      JSON.stringify([{ replica_id: 'desktop', max_write_id: '8' }])
    );
    redisStore.set(
      'vfs:crdt:replicaWriteIds:legacy:user-1',
      JSON.stringify([{ replica_id: 'desktop', max_write_id: '8' }])
    );

    await invalidateReplicaWriteIdRowsForUser('user-1');

    expect(redisStore.has('vfs:crdt:replicaWriteIds:heads:user-1')).toBe(false);
    expect(redisStore.has('vfs:crdt:replicaWriteIds:legacy:user-1')).toBe(
      false
    );
  });

  it('fails open to replica-head reads for invalid flag values', () => {
    vi.stubEnv('VFS_CRDT_REPLICA_HEADS_READS', 'not-a-boolean');
    expect(areReplicaHeadReadsEnabled()).toBe(true);
  });

  it('accepts numeric false flag values', () => {
    vi.stubEnv('VFS_CRDT_REPLICA_HEADS_READS', '0');
    expect(areReplicaHeadReadsEnabled()).toBe(false);
  });
});
