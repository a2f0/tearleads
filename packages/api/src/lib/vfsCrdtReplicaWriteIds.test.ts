import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  areReplicaHeadReadsEnabled,
  loadReplicaWriteIdRows
} from './vfsCrdtReplicaWriteIds.js';

describe('vfsCrdtReplicaWriteIds', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();
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

  it('fails open to replica-head reads for invalid flag values', () => {
    vi.stubEnv('VFS_CRDT_REPLICA_HEADS_READS', 'not-a-boolean');
    expect(areReplicaHeadReadsEnabled()).toBe(true);
  });

  it('accepts numeric false flag values', () => {
    vi.stubEnv('VFS_CRDT_REPLICA_HEADS_READS', '0');
    expect(areReplicaHeadReadsEnabled()).toBe(false);
  });
});
