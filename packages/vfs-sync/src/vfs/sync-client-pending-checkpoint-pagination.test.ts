import { describe, expect, it } from 'vitest';
import { runPendingCheckpointPaginationScenario } from './sync-client-pending-checkpoint-pagination-test-support.js';

describe('VfsBackgroundSyncClient', () => {
  it('preserves pending-order and paginated windows when resuming from mid-chain checkpoint with queued locals', async () => {
    const seeds = [1441, 1442] as const;

    for (const seed of seeds) {
      const firstRun = await runPendingCheckpointPaginationScenario(seed);
      const secondRun = await runPendingCheckpointPaginationScenario(seed);

      expect(secondRun).toEqual(firstRun);
      expect(firstRun.firstSyncError).toMatch(
        /regressed lastReconciledWriteIds for replica desktop/
      );
      expect(firstRun.secondSyncError).toMatch(
        /regressed lastReconciledWriteIds for replica mobile/
      );
      expect(firstRun.pageSignatures).toEqual(firstRun.expectedPageSignatures);
      expect(firstRun.guardrailSignatures).toEqual(
        firstRun.expectedGuardrailSignatures
      );
      expect(firstRun.pushedOpIds).toEqual(firstRun.expectedPushedOpIds);
      expect(firstRun.pushedWriteIds).toEqual(firstRun.expectedPushedWriteIds);
    }
  });
});
