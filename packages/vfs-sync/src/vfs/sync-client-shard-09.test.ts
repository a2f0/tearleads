import { describe, expect, it } from 'vitest';
import {
  runBoundaryReplayAvoidanceScenario,
  runReplicaHandoffMonotonicScenario
} from './sync-client-shard-09-test-support.js';
import { compareVfsSyncCursorOrder } from './sync-client-test-support.js';

describe('VfsBackgroundSyncClient', () => {
  it('keeps replay cursor monotonic across sequential replica handoff cycles', async () => {
    const run = await runReplicaHandoffMonotonicScenario();

    expect(run.cycleOnePulls.length).toBeGreaterThanOrEqual(2);
    expect(run.cycleOnePulls[0]?.requestCursor).toEqual(run.seedReplayCursor);
    expect(run.cycleOnePulls[run.cycleOnePulls.length - 1]?.hasMore).toBe(
      false
    );

    const cycleOneItems = run.cycleOnePulls.flatMap((page) => page.items);
    expect(cycleOneItems).toContainEqual(
      expect.objectContaining({
        opId: 'mobile-2',
        opType: 'link_add',
        itemId: 'item-handoff-a'
      })
    );
    expect(cycleOneItems).toContainEqual(
      expect.objectContaining({
        opId: 'mobile-3',
        opType: 'acl_add',
        itemId: 'item-handoff-b'
      })
    );

    expect(run.cycleTwoPulls.length).toBeGreaterThanOrEqual(2);
    expect(run.cycleTwoPulls[0]?.requestCursor).toEqual(
      run.cycleOneTerminalCursor
    );
    expect(run.cycleTwoPulls[run.cycleTwoPulls.length - 1]?.hasMore).toBe(
      false
    );

    const cycleTwoItems = run.cycleTwoPulls.flatMap((page) => page.items);
    expect(cycleTwoItems).toContainEqual(
      expect.objectContaining({
        opId: 'tablet-1',
        opType: 'link_add',
        itemId: 'item-handoff-c'
      })
    );
    expect(cycleTwoItems).toContainEqual(
      expect.objectContaining({
        opId: 'tablet-2',
        opType: 'acl_add',
        itemId: 'item-handoff-c'
      })
    );
    expect(cycleTwoItems.map((item) => item.opId)).not.toContain(
      run.cycleOneTerminalCursor.changeId
    );
    expect(cycleTwoItems.map((item) => item.opId)).not.toContain(
      run.seedReplayCursor.changeId
    );

    for (const item of cycleTwoItems) {
      expect(
        compareVfsSyncCursorOrder(
          {
            changedAt: item.occurredAt,
            changeId: item.opId
          },
          run.cycleOneTerminalCursor
        )
      ).toBeGreaterThan(0);
    }
  });

  it('avoids boundary replay across restart paginated pulls while write-id baselines stay monotonic', async () => {
    const run = await runBoundaryReplayAvoidanceScenario();

    expect(run.seedGuardrailViolations).toEqual([]);
    expect(run.resumedPulls.length).toBe(2);
    expect(run.resumedPulls[0]?.requestCursor).toEqual(run.seedReplayCursor);
    expect(run.resumedPulls[0]?.items.map((item) => item.opId)).toEqual([
      'remote-3'
    ]);
    expect(run.resumedPulls[0]?.lastReconciledWriteIds?.remote).toBe(4);
    expect(run.resumedPulls[1]?.requestCursor).toEqual({
      changedAt: '2026-02-14T14:35:02.000Z',
      changeId: 'remote-3'
    });
    expect(run.resumedPulls[1]?.items.map((item) => item.opId)).toEqual([
      'remote-4'
    ]);
    expect(run.resumedPulls[1]?.hasMore).toBe(false);

    expect(run.resumedPulledOpIds).not.toContain(run.seedReplayCursor.changeId);
    for (const pull of run.resumedPulls) {
      for (const item of pull.items) {
        expect(
          compareVfsSyncCursorOrder(
            {
              changedAt: item.occurredAt,
              changeId: item.opId
            },
            run.seedReplayCursor
          )
        ).toBeGreaterThan(0);
      }
    }

    expect(run.resumedGuardrailViolations).toEqual([]);
    expect(run.resumedLastReconciledRemoteWriteId).toBe(4);
    expect(
      compareVfsSyncCursorOrder(run.resumedCursor, run.seedReplayCursor)
    ).toBeGreaterThan(0);
  });
});
