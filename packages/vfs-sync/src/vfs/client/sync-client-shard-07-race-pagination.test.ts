import { describe, expect, it } from 'vitest';
import {
  runContainerClockPaginationRestartScenario,
  runForwardOnlyPaginationAfterHydrateRaceScenario,
  runHydrateRejectionDuringFlushConvergenceScenario
} from './sync-client-shard-07-race-pagination-test-support.js';
import {
  compareVfsSyncCursorOrder,
  expectContainerClocksMonotonic
} from './sync-client-test-support.js';

describe('VfsBackgroundSyncClient', () => {
  it('preserves cross-client convergence after hydrate rejection during in-flight flush', async () => {
    const run = await runHydrateRejectionDuringFlushConvergenceScenario();

    expect(run.hydrateError).toMatch(/flush is in progress/);
    expect(run.guardrailViolations).toContainEqual({
      code: 'hydrateGuardrailViolation',
      stage: 'hydrate',
      message: 'cannot hydrate state while flush is in progress'
    });

    expect(run.desktopSnapshot.pendingOperations).toBe(0);
    expect(run.mobileSnapshot.pendingOperations).toBe(0);
    expect(run.desktopSnapshot.acl).toEqual(run.serverSnapshot.acl);
    expect(run.mobileSnapshot.acl).toEqual(run.serverSnapshot.acl);
    expect(run.desktopSnapshot.links).toEqual(run.serverSnapshot.links);
    expect(run.mobileSnapshot.links).toEqual(run.serverSnapshot.links);
    expect(run.desktopSnapshot.lastReconciledWriteIds).toEqual(
      run.serverSnapshot.lastReconciledWriteIds
    );
    expect(run.mobileSnapshot.lastReconciledWriteIds).toEqual(
      run.serverSnapshot.lastReconciledWriteIds
    );
    expectContainerClocksMonotonic(
      run.desktopStateBeforeHydrate.containerClocks,
      run.desktopSnapshot.containerClocks
    );
    expectContainerClocksMonotonic(
      run.mobileSnapshotBeforeDesktopResume.containerClocks,
      run.mobileSnapshot.containerClocks
    );
  });

  it('keeps listChangedContainers pagination forward-only after hydrate rejection race', async () => {
    const run = await runForwardOnlyPaginationAfterHydrateRaceScenario();

    expect(run.hydrateError).toMatch(/flush is in progress/);
    expect(run.guardrailViolations).toContainEqual({
      code: 'hydrateGuardrailViolation',
      stage: 'hydrate',
      message: 'cannot hydrate state while flush is in progress'
    });

    expect(run.firstPageAfterBaseline.items.length).toBe(1);
    expect(
      compareVfsSyncCursorOrder(
        {
          changedAt: run.firstPageAfterBaseline.items[0]?.changedAt ?? '',
          changeId: run.firstPageAfterBaseline.items[0]?.changeId ?? ''
        },
        run.baselineCursor
      )
    ).toBeGreaterThan(0);

    for (const item of run.secondPageAfterBaseline.items) {
      expect(
        compareVfsSyncCursorOrder(
          {
            changedAt: item.changedAt,
            changeId: item.changeId
          },
          run.firstCursor
        )
      ).toBeGreaterThan(0);
    }
  });

  it('preserves container-clock pagination boundaries across export and hydrate restart', async () => {
    const run = await runContainerClockPaginationRestartScenario();

    expect(run.firstPageAfter).toEqual(run.firstPageBefore);
    expect(run.secondPageAfter).toEqual(run.secondPageBefore);
    expect(run.thirdPageAfter).toEqual(run.thirdPageBefore);
  });
});
