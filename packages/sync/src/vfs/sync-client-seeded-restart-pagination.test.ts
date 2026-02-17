import { describe, expect, it } from 'vitest';
import { runSeededRestartPaginationScenario } from './sync-client-seeded-restart-pagination-test-support.js';

describe('VfsBackgroundSyncClient', () => {
  it('preserves seeded paginated recovery signatures across mid-chain export and hydrate restarts', async () => {
    const seeds = [1331, 1332] as const;

    for (const seed of seeds) {
      const baseline = await runSeededRestartPaginationScenario(seed, false);
      const restarted = await runSeededRestartPaginationScenario(seed, true);

      expect(restarted).toEqual(baseline);
      expect(baseline.firstSyncError).toMatch(
        /regressed lastReconciledWriteIds for replica desktop/
      );
      expect(baseline.secondSyncError).toMatch(
        /regressed lastReconciledWriteIds for replica mobile/
      );
      expect(baseline.pageSignatures).toEqual(baseline.expectedPageSignatures);
      expect(baseline.pageSignatures).not.toContain(
        baseline.excludedPhantomSignature
      );
      expect(baseline.guardrailSignatures).toEqual(
        baseline.expectedGuardrailSignatures
      );
    }
  });
});
