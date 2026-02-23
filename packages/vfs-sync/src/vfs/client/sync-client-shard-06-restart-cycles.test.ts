import { describe, expect, it } from 'vitest';
import {
  runReplayAlignedLagRestartCycleScenario,
  runThreeCycleAlternatingReconcileScenario
} from './sync-client-shard-06-restart-cycles-test-support.js';
import { compareVfsSyncCursorOrder } from './sync-client-test-support.js';

describe('VfsBackgroundSyncClient', () => {
  it('keeps cursor and write-id monotonicity across three deterministic restart cycles with alternating reconcile lineage', async () => {
    const run = await runThreeCycleAlternatingReconcileScenario();

    for (const metric of run.cycleMetrics) {
      expect(metric.pushedWriteIds).toEqual([
        metric.cycleStartWriteId,
        metric.cycleStartWriteId + 1
      ]);
      expect(metric.nextLocalWriteId).toBe(metric.cycleStartWriteId + 2);
      expect(metric.desktopLastReconciledWriteId).toBe(
        metric.cycleStartWriteId + 1
      );
      expect(metric.firstPushedOccurredAtMs).toBeGreaterThan(
        metric.persistedCursorMs
      );
      expect(metric.secondPushedOccurredAtMs).toBeGreaterThan(
        metric.firstPushedOccurredAtMs
      );
    }

    for (let index = 1; index < run.cycleCursors.length; index++) {
      const previousCursor = run.cycleCursors[index - 1];
      const cursor = run.cycleCursors[index];
      if (!previousCursor || !cursor) {
        throw new Error('missing cycle cursor for monotonicity assertion');
      }
      expect(compareVfsSyncCursorOrder(cursor, previousCursor)).toBeGreaterThan(
        0
      );
    }

    expect(run.cyclePushWriteIds).toEqual([
      [10, 11],
      [16, 17],
      [23, 24]
    ]);
    expect(run.guardrailViolations).toEqual([]);
  });

  it('normalizes repeated reconcile write-id lag under replay-aligned restart cycles without guardrail noise', async () => {
    const run = await runReplayAlignedLagRestartCycleScenario();

    for (const metric of run.cycleMetrics) {
      expect(metric.pushedWriteIds).toEqual([
        metric.cycleStartWriteId,
        metric.cycleStartWriteId + 1
      ]);
      expect(metric.nextLocalWriteId).toBe(metric.cycleStartWriteId + 2);
      expect(metric.desktopLastReconciledWriteId).toBe(
        metric.cycleStartWriteId + 1
      );
      expect(metric.firstPushedOccurredAtMs).toBeGreaterThan(
        metric.persistedCursorMs
      );
      expect(metric.secondPushedOccurredAtMs).toBeGreaterThan(
        metric.firstPushedOccurredAtMs
      );
    }

    for (let index = 1; index < run.cycleCursors.length; index++) {
      const previousCursor = run.cycleCursors[index - 1];
      const cursor = run.cycleCursors[index];
      if (!previousCursor || !cursor) {
        throw new Error('missing cycle cursor for monotonicity assertion');
      }
      expect(compareVfsSyncCursorOrder(cursor, previousCursor)).toBeGreaterThan(
        0
      );
    }

    expect(run.replayAlignedAfterFlush).toEqual([true, true, true]);
    expect(run.cyclePushWriteIds).toEqual([
      [12, 13],
      [20, 21],
      [29, 30]
    ]);
    expect(run.guardrailViolations).toEqual([]);
  });
});
