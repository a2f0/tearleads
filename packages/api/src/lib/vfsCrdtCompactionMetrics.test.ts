import { describe, expect, it, vi } from 'vitest';
import {
  buildVfsCrdtCompactionRunMetric,
  emitVfsCrdtCompactionRunMetric,
  isVfsCrdtCompactionRunMetric
} from './vfsCrdtCompactionMetrics.js';

describe('vfsCrdtCompactionMetrics', () => {
  it('builds success metric payload', () => {
    const metric = buildVfsCrdtCompactionRunMetric({
      plan: {
        now: '2026-02-24T00:00:00.000Z',
        latestCursor: {
          changedAt: '2026-02-24T00:00:00.000Z',
          changeId: 'crdt:100'
        },
        hotRetentionFloor: '2026-01-25T00:00:00.000Z',
        activeClientCount: 2,
        staleClientCount: 1,
        oldestActiveCursor: {
          changedAt: '2026-02-20T00:00:00.000Z',
          changeId: 'crdt:90'
        },
        cutoffOccurredAt: '2026-01-25T00:00:00.000Z',
        estimatedRowsToDelete: 10,
        staleClientIds: ['old-tablet'],
        note: 'test plan'
      },
      executed: true,
      success: true,
      deletedRows: 7,
      durationMs: 123.9,
      occurredAt: new Date('2026-02-24T12:00:00.000Z')
    });

    expect(metric).toEqual({
      metricVersion: 1,
      event: 'vfs_crdt_compaction_run',
      occurredAt: '2026-02-24T12:00:00.000Z',
      success: true,
      executed: true,
      durationMs: 123,
      cutoffOccurredAt: '2026-01-25T00:00:00.000Z',
      estimatedRowsToDelete: 10,
      deletedRows: 7,
      activeClientCount: 2,
      staleClientCount: 1,
      staleClientIds: ['old-tablet'],
      error: null
    });
  });

  it('normalizes error metric payload', () => {
    const metric = buildVfsCrdtCompactionRunMetric({
      plan: {
        now: '2026-02-24T00:00:00.000Z',
        latestCursor: null,
        hotRetentionFloor: null,
        activeClientCount: 0,
        staleClientCount: 0,
        oldestActiveCursor: null,
        cutoffOccurredAt: null,
        estimatedRowsToDelete: 0,
        staleClientIds: [],
        note: 'none'
      },
      executed: false,
      success: false,
      deletedRows: -5,
      durationMs: -1,
      error: new Error('boom'),
      occurredAt: new Date('2026-02-24T12:00:00.000Z')
    });

    expect(metric.error).toBe('boom');
    expect(metric.durationMs).toBe(0);
    expect(metric.deletedRows).toBe(0);
  });

  it('validates metric schema', () => {
    const metric = buildVfsCrdtCompactionRunMetric({
      plan: {
        now: '2026-02-24T00:00:00.000Z',
        latestCursor: null,
        hotRetentionFloor: null,
        activeClientCount: 0,
        staleClientCount: 0,
        oldestActiveCursor: null,
        cutoffOccurredAt: null,
        estimatedRowsToDelete: 0,
        staleClientIds: [],
        note: 'none'
      },
      executed: false,
      success: true,
      deletedRows: 0,
      durationMs: 1
    });

    expect(isVfsCrdtCompactionRunMetric(metric)).toBe(true);
    expect(
      isVfsCrdtCompactionRunMetric({
        ...metric,
        durationMs: -1
      })
    ).toBe(false);
  });

  it('rejects malformed metric field variants', () => {
    const valid = buildVfsCrdtCompactionRunMetric({
      plan: {
        now: '2026-02-24T00:00:00.000Z',
        latestCursor: null,
        hotRetentionFloor: null,
        activeClientCount: 0,
        staleClientCount: 0,
        oldestActiveCursor: null,
        cutoffOccurredAt: null,
        estimatedRowsToDelete: 0,
        staleClientIds: [],
        note: 'none'
      },
      executed: false,
      success: true,
      deletedRows: 0,
      durationMs: 1
    });

    const invalidVariants: unknown[] = [
      { ...valid, metricVersion: 2 },
      { ...valid, event: 'wrong' },
      { ...valid, occurredAt: 'invalid-date' },
      { ...valid, success: 'yes' },
      { ...valid, executed: 'no' },
      { ...valid, cutoffOccurredAt: 123 },
      { ...valid, estimatedRowsToDelete: -1 },
      { ...valid, deletedRows: -1 },
      { ...valid, activeClientCount: -1 },
      { ...valid, staleClientCount: -1 },
      { ...valid, staleClientIds: ['ok', 1] },
      { ...valid, error: 42 }
    ];

    for (const invalid of invalidVariants) {
      expect(isVfsCrdtCompactionRunMetric(invalid)).toBe(false);
    }
  });

  it('emits serialized metric payload', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const metric = buildVfsCrdtCompactionRunMetric({
      plan: {
        now: '2026-02-24T00:00:00.000Z',
        latestCursor: null,
        hotRetentionFloor: null,
        activeClientCount: 0,
        staleClientCount: 0,
        oldestActiveCursor: null,
        cutoffOccurredAt: null,
        estimatedRowsToDelete: 0,
        staleClientIds: [],
        note: 'none'
      },
      executed: false,
      success: true,
      deletedRows: 0,
      durationMs: 1
    });

    emitVfsCrdtCompactionRunMetric(metric);

    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0]?.[0]).toContain(
      '"event":"vfs_crdt_compaction_run"'
    );
    spy.mockRestore();
  });
});
