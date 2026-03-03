import { describe, expect, it, vi } from 'vitest';
import {
  checkVfsCrdtReplicaHeadsParity,
  DEFAULT_VFS_CRDT_REPLICA_HEADS_PARITY_SAMPLE_LIMIT
} from './vfsCrdtReplicaHeadsParity.js';

describe('checkVfsCrdtReplicaHeadsParity', () => {
  it('returns summary counts without loading mismatch samples when parity is clean', async () => {
    const query = vi.fn().mockResolvedValueOnce({
      rows: [
        {
          checked_pair_count: '3',
          mismatch_count: '0',
          missing_head_count: '0',
          stale_head_count: '0',
          write_id_mismatch_count: '0',
          occurred_at_mismatch_count: '0'
        }
      ]
    });

    const result = await checkVfsCrdtReplicaHeadsParity(
      { query },
      { sampleLimit: 25 }
    );

    expect(query).toHaveBeenCalledTimes(1);
    expect(query.mock.calls[0]?.[1]).toEqual(['vfs_crdt_client_push']);
    expect(result).toEqual({
      checkedPairCount: 3,
      mismatchCount: 0,
      missingHeadCount: 0,
      staleHeadCount: 0,
      writeIdMismatchCount: 0,
      occurredAtMismatchCount: 0,
      sampleLimit: 25,
      sampledMismatchCount: 0,
      mismatches: []
    });
  });

  it('loads and classifies mismatch samples when parity drift exists', async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce({
        rows: [
          {
            checked_pair_count: '12',
            mismatch_count: '5',
            missing_head_count: '1',
            stale_head_count: '1',
            write_id_mismatch_count: '2',
            occurred_at_mismatch_count: '2'
          }
        ]
      })
      .mockResolvedValueOnce({
        rows: [
          {
            actor_id: 'actor-1',
            replica_id: 'desktop',
            expected_max_write_id: '11',
            actual_max_write_id: null,
            expected_max_occurred_at: '2026-03-01T01:00:00.000Z',
            actual_max_occurred_at: null
          },
          {
            actor_id: 'actor-1',
            replica_id: 'mobile',
            expected_max_write_id: null,
            actual_max_write_id: '8',
            expected_max_occurred_at: null,
            actual_max_occurred_at: '2026-03-01T01:10:00.000Z'
          },
          {
            actor_id: 'actor-2',
            replica_id: 'desktop',
            expected_max_write_id: '9',
            actual_max_write_id: '10',
            expected_max_occurred_at: '2026-03-01T02:00:00.000Z',
            actual_max_occurred_at: '2026-03-01T02:00:00.000Z'
          },
          {
            actor_id: 'actor-3',
            replica_id: 'desktop',
            expected_max_write_id: '14',
            actual_max_write_id: '14',
            expected_max_occurred_at: new Date('2026-03-01T02:00:00.000Z'),
            actual_max_occurred_at: new Date('2026-03-01T02:05:00.000Z')
          },
          {
            actor_id: 'actor-4',
            replica_id: 'desktop',
            expected_max_write_id: '20',
            actual_max_write_id: '22',
            expected_max_occurred_at: '2026-03-01T03:00:00.000Z',
            actual_max_occurred_at: '2026-03-01T03:05:00.000Z'
          }
        ]
      });

    const result = await checkVfsCrdtReplicaHeadsParity(
      { query },
      { sampleLimit: 10 }
    );

    expect(query).toHaveBeenCalledTimes(2);
    expect(query.mock.calls[1]?.[1]).toEqual(['vfs_crdt_client_push', 10]);
    expect(result.checkedPairCount).toBe(12);
    expect(result.mismatchCount).toBe(5);
    expect(result.sampledMismatchCount).toBe(5);
    expect(result.mismatches.map((entry) => entry.reason)).toEqual([
      'missing_head',
      'stale_head',
      'write_id',
      'occurred_at',
      'write_id_and_occurred_at'
    ]);
  });

  it('uses the default sample limit when no option is provided', async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce({
        rows: [
          {
            checked_pair_count: '1',
            mismatch_count: '1',
            missing_head_count: '1',
            stale_head_count: '0',
            write_id_mismatch_count: '0',
            occurred_at_mismatch_count: '0'
          }
        ]
      })
      .mockResolvedValueOnce({
        rows: []
      });

    await checkVfsCrdtReplicaHeadsParity({ query });

    expect(query.mock.calls[1]?.[1]).toEqual([
      'vfs_crdt_client_push',
      DEFAULT_VFS_CRDT_REPLICA_HEADS_PARITY_SAMPLE_LIMIT
    ]);
  });

  it('rejects invalid sample limits', async () => {
    const query = vi.fn();
    await expect(
      checkVfsCrdtReplicaHeadsParity({ query }, { sampleLimit: -1 })
    ).rejects.toThrow('sampleLimit must be a non-negative integer');
    expect(query).not.toHaveBeenCalled();
  });

  it('fails fast when count values exceed safe integer range', async () => {
    const query = vi.fn().mockResolvedValueOnce({
      rows: [
        {
          checked_pair_count: '9007199254740992',
          mismatch_count: '0',
          missing_head_count: '0',
          stale_head_count: '0',
          write_id_mismatch_count: '0',
          occurred_at_mismatch_count: '0'
        }
      ]
    });

    await expect(checkVfsCrdtReplicaHeadsParity({ query })).rejects.toThrow(
      'CRDT parity count exceeds Number.MAX_SAFE_INTEGER'
    );
  });
});
