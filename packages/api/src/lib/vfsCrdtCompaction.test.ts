import { describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_VFS_CRDT_CLIENT_PREFIX,
  executeVfsCrdtCompaction,
  planVfsCrdtCompaction,
  planVfsCrdtCompactionFromState
} from './vfsCrdtCompaction.js';
import { buildVfsCrdtCompactionDeleteQuery } from './vfsCrdtCompactionSql.js';

describe('vfsCrdtCompaction plan', () => {
  it('returns no-op plan when there are no CRDT operations', () => {
    const plan = planVfsCrdtCompactionFromState({
      latestCursor: null,
      clientState: [],
      options: {
        now: new Date('2026-02-24T00:00:00.000Z')
      }
    });

    expect(plan.cutoffOccurredAt).toBeNull();
    expect(plan.estimatedRowsToDelete).toBe(0);
    expect(plan.note).toContain('No CRDT operations found');
  });

  it('uses hot retention floor when no active clients exist', () => {
    const plan = planVfsCrdtCompactionFromState({
      latestCursor: {
        changedAt: '2026-02-24T12:00:00.000Z',
        changeId: 'crdt:200'
      },
      clientState: [
        {
          clientId: `${DEFAULT_VFS_CRDT_CLIENT_PREFIX}old-device`,
          lastReconciledAt: '2025-10-10T00:00:00.000Z',
          lastReconciledChangeId: 'crdt:10',
          updatedAt: '2025-10-10T00:00:00.000Z'
        }
      ],
      estimatedRowsToDelete: 99,
      options: {
        now: new Date('2026-02-24T12:00:00.000Z'),
        hotRetentionMs: 7 * 24 * 60 * 60 * 1000,
        inactiveClientWindowMs: 24 * 60 * 60 * 1000,
        cursorSafetyBufferMs: 0
      }
    });

    expect(plan.activeClientCount).toBe(0);
    expect(plan.staleClientCount).toBe(1);
    expect(plan.staleClientIds).toEqual(['old-device']);
    expect(plan.cutoffOccurredAt).toBe('2026-02-17T12:00:00.000Z');
    expect(plan.estimatedRowsToDelete).toBe(99);
  });

  it('bounds cutoff by oldest active cursor and safety buffer', () => {
    const plan = planVfsCrdtCompactionFromState({
      latestCursor: {
        changedAt: '2026-02-24T12:00:00.000Z',
        changeId: 'crdt:500'
      },
      clientState: [
        {
          clientId: `${DEFAULT_VFS_CRDT_CLIENT_PREFIX}desktop`,
          lastReconciledAt: '2026-02-20T09:00:00.000Z',
          lastReconciledChangeId: 'crdt:320',
          updatedAt: '2026-02-24T11:00:00.000Z'
        },
        {
          clientId: `${DEFAULT_VFS_CRDT_CLIENT_PREFIX}mobile`,
          lastReconciledAt: '2026-02-23T00:00:00.000Z',
          lastReconciledChangeId: 'crdt:450',
          updatedAt: '2026-02-24T11:00:00.000Z'
        }
      ],
      options: {
        now: new Date('2026-02-24T12:00:00.000Z'),
        hotRetentionMs: 24 * 60 * 60 * 1000,
        inactiveClientWindowMs: 30 * 24 * 60 * 60 * 1000,
        cursorSafetyBufferMs: 2 * 60 * 60 * 1000
      }
    });

    expect(plan.activeClientCount).toBe(2);
    expect(plan.staleClientCount).toBe(0);
    expect(plan.oldestActiveCursor).toEqual({
      changedAt: '2026-02-20T09:00:00.000Z',
      changeId: 'crdt:320'
    });
    expect(plan.cutoffOccurredAt).toBe('2026-02-20T07:00:00.000Z');
  });

  it('keeps stale clients out of active frontier', () => {
    const plan = planVfsCrdtCompactionFromState({
      latestCursor: {
        changedAt: '2026-02-24T12:00:00.000Z',
        changeId: 'crdt:500'
      },
      clientState: [
        {
          clientId: `${DEFAULT_VFS_CRDT_CLIENT_PREFIX}desktop`,
          lastReconciledAt: '2026-02-22T00:00:00.000Z',
          lastReconciledChangeId: 'crdt:420',
          updatedAt: '2026-02-24T11:00:00.000Z'
        },
        {
          clientId: `${DEFAULT_VFS_CRDT_CLIENT_PREFIX}very-old-tablet`,
          lastReconciledAt: '2025-05-01T00:00:00.000Z',
          lastReconciledChangeId: 'crdt:5',
          updatedAt: '2025-05-01T00:00:00.000Z'
        }
      ],
      options: {
        now: new Date('2026-02-24T12:00:00.000Z'),
        hotRetentionMs: 14 * 24 * 60 * 60 * 1000,
        inactiveClientWindowMs: 10 * 24 * 60 * 60 * 1000,
        cursorSafetyBufferMs: 0
      }
    });

    expect(plan.activeClientCount).toBe(1);
    expect(plan.staleClientIds).toEqual(['very-old-tablet']);
    expect(plan.note).toContain('re-materialization');
    expect(plan.cutoffOccurredAt).toBe('2026-02-10T12:00:00.000Z');
  });

  it('builds unbounded delete query by default', () => {
    const query = buildVfsCrdtCompactionDeleteQuery('2026-02-10T12:00:00.000Z');

    expect(query.values).toEqual(['2026-02-10T12:00:00.000Z']);
    expect(query.text).toContain('DELETE FROM vfs_crdt_ops');
    expect(query.text).not.toContain('LIMIT $2::integer');
  });

  it('builds bounded delete query when maxDeleteRows is configured', () => {
    const query = buildVfsCrdtCompactionDeleteQuery(
      '2026-02-10T12:00:00.000Z',
      {
        maxDeleteRows: 250
      }
    );

    expect(query.values).toEqual(['2026-02-10T12:00:00.000Z', 250]);
    expect(query.text).toContain('LIMIT $2::integer');
    expect(query.text).toContain('USING targets');
  });

  it('plans compaction with estimated delete count from database', async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce({
        rows: [
          {
            occurred_at: '2026-02-24T12:00:00.000Z',
            id: 'crdt:500'
          }
        ]
      })
      .mockResolvedValueOnce({
        rows: [
          {
            client_id: 'crdt:desktop',
            last_reconciled_at: '2026-02-20T09:00:00.000Z',
            last_reconciled_change_id: 'crdt:320',
            updated_at: '2026-02-24T11:00:00.000Z'
          }
        ]
      })
      .mockResolvedValueOnce({
        rows: [
          {
            count: '12'
          }
        ]
      });

    const plan = await planVfsCrdtCompaction(
      {
        query
      },
      {
        now: new Date('2026-02-24T12:00:00.000Z'),
        hotRetentionMs: 24 * 60 * 60 * 1000,
        inactiveClientWindowMs: 30 * 24 * 60 * 60 * 1000,
        cursorSafetyBufferMs: 2 * 60 * 60 * 1000
      }
    );

    expect(plan.cutoffOccurredAt).toBe('2026-02-20T07:00:00.000Z');
    expect(plan.estimatedRowsToDelete).toBe(12);
    expect(query).toHaveBeenCalledTimes(3);
  });

  it('plans no-op compaction when there is no latest cursor', async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });

    const plan = await planVfsCrdtCompaction({
      query
    });

    expect(plan.cutoffOccurredAt).toBeNull();
    expect(plan.estimatedRowsToDelete).toBe(0);
    expect(query).toHaveBeenCalledTimes(2);
  });

  it('executes compaction with and without delete bounds', async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce({ rows: [{ count: '5' }] })
      .mockResolvedValueOnce({ rows: [{ count: '2' }] });

    const basePlan = {
      now: '2026-02-24T12:00:00.000Z',
      latestCursor: {
        changedAt: '2026-02-24T12:00:00.000Z',
        changeId: 'crdt:500'
      },
      hotRetentionFloor: '2026-02-20T12:00:00.000Z',
      activeClientCount: 1,
      staleClientCount: 0,
      oldestActiveCursor: {
        changedAt: '2026-02-22T12:00:00.000Z',
        changeId: 'crdt:480'
      },
      cutoffOccurredAt: '2026-02-20T07:00:00.000Z',
      estimatedRowsToDelete: 7,
      staleClientIds: [],
      note: 'test'
    } as const;

    const deletedUnbounded = await executeVfsCrdtCompaction(
      { query },
      basePlan
    );
    const deletedBounded = await executeVfsCrdtCompaction({ query }, basePlan, {
      maxDeleteRows: 2
    });

    expect(deletedUnbounded).toBe(5);
    expect(deletedBounded).toBe(2);
    expect(query.mock.calls[0]?.[0]).not.toContain('LIMIT $2::integer');
    expect(query.mock.calls[1]?.[0]).toContain('LIMIT $2::integer');
  });

  it('skips execute when plan has no cutoff', async () => {
    const query = vi.fn();
    const deletedRows = await executeVfsCrdtCompaction(
      { query },
      {
        now: '2026-02-24T12:00:00.000Z',
        latestCursor: null,
        hotRetentionFloor: null,
        activeClientCount: 0,
        staleClientCount: 0,
        oldestActiveCursor: null,
        cutoffOccurredAt: null,
        estimatedRowsToDelete: 0,
        staleClientIds: [],
        note: 'none'
      }
    );

    expect(deletedRows).toBe(0);
    expect(query).not.toHaveBeenCalled();
  });
});
