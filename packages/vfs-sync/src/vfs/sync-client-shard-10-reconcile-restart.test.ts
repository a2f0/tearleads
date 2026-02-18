import { describe, expect, it } from 'vitest';
import {
  runReconcileRestartRecoveryScenario,
  runReconcileRestartRegressionScenario
} from './sync-client-shard-10-reconcile-restart-test-support.js';

describe('VfsBackgroundSyncClient', () => {
  it('fails closed when post-restart reconcile acknowledgement regresses non-primary replica after paginated pulls', async () => {
    const run = await runReconcileRestartRegressionScenario();

    expect(run.syncError).toMatch(
      /regressed lastReconciledWriteIds for replica mobile/
    );
    expect(run.guardrailViolations).toContainEqual({
      code: 'lastWriteIdRegression',
      stage: 'reconcile',
      message: 'reconcile acknowledgement regressed replica write-id state',
      details: {
        replicaId: 'mobile',
        previousWriteId: 5,
        incomingWriteId: 4
      }
    });

    expect(run.resumedPulls.length).toBe(2);
    expect(run.resumedPulls[0]?.requestCursor).toEqual(run.seedReplayCursor);
    expect(run.resumedPulls[1]?.requestCursor).toEqual({
      changedAt: '2026-02-14T12:23:02.000Z',
      changeId: 'remote-3'
    });

    expect(run.finalSnapshot.lastReconciledWriteIds).toEqual({
      desktop: 3,
      mobile: 5,
      remote: 4
    });
    expect(run.hasRecoveredAcl).toBe(true);
    expect(run.finalSnapshot.cursor).toEqual({
      changedAt: '2026-02-14T12:23:03.000Z',
      changeId: 'remote-4'
    });
  });

  it('recovers on subsequent cycle when reconcile acknowledgement is corrected after prior restart regression', async () => {
    const run = await runReconcileRestartRecoveryScenario();

    expect(run.firstSyncError).toMatch(
      /regressed lastReconciledWriteIds for replica mobile/
    );
    expect(run.guardrailViolations).toContainEqual({
      code: 'lastWriteIdRegression',
      stage: 'reconcile',
      message: 'reconcile acknowledgement regressed replica write-id state',
      details: {
        replicaId: 'mobile',
        previousWriteId: 5,
        incomingWriteId: 4
      }
    });

    expect(run.postFailureSnapshot.lastReconciledWriteIds).toEqual({
      desktop: 3,
      mobile: 5,
      remote: 4
    });
    expect(run.postFailureSnapshot.cursor).toEqual({
      changedAt: '2026-02-14T12:24:03.000Z',
      changeId: 'remote-4'
    });

    expect(run.recoveryResult).toEqual({
      pulledOperations: 0,
      pullPages: 1
    });
    expect(run.guardrailCountAfterRecovery).toBe(
      run.guardrailCountBeforeRecovery
    );
    expect(run.postRecoverySnapshot.lastReconciledWriteIds).toEqual({
      desktop: 4,
      mobile: 6,
      remote: 4
    });
    expect(run.postRecoverySnapshot.cursor).toEqual({
      changedAt: '2026-02-14T12:24:03.000Z',
      changeId: 'remote-4'
    });

    expect(run.resumedPulls.length).toBe(3);
    expect(run.resumedPulls[0]?.requestCursor).toEqual(run.seedReplayCursor);
    expect(run.resumedPulls[1]?.requestCursor).toEqual({
      changedAt: '2026-02-14T12:24:02.000Z',
      changeId: 'remote-3'
    });
    expect(run.resumedPulls[2]?.requestCursor).toEqual({
      changedAt: '2026-02-14T12:24:03.000Z',
      changeId: 'remote-4'
    });
    expect(run.resumedPulls[2]?.items).toEqual([]);
  });
});
