import { describe, expect, it } from 'vitest';
import {
  DEFAULT_VFS_CRDT_CLIENT_PREFIX,
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
});
