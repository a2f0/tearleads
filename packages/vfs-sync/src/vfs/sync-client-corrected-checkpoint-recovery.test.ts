import { describe, expect, it } from 'vitest';
import {
  runCorrectedCheckpointDeterministicScenario,
  runCorrectedCheckpointRecoveryScenario
} from './sync-client-corrected-checkpoint-recovery-test-support.js';
import { toStageCodeSignatures } from './sync-client-randomized-test-support.js';

describe('VfsBackgroundSyncClient', () => {
  it('recovers with corrected checkpoint payload after malformed pending rejection and preserves push ordering', async () => {
    const run = await runCorrectedCheckpointRecoveryScenario();

    expect(run.malformedHydrateError).toBe(
      'state.pendingOperations[1] has link childId that does not match itemId'
    );
    expect(run.guardrailViolations).toEqual([
      {
        code: 'hydrateGuardrailViolation',
        stage: 'hydrate',
        message:
          'state.pendingOperations[1] has link childId that does not match itemId'
      }
    ]);
    expect(run.pushedOpIds).toEqual(run.expectedPushedOpIds);
    expect(run.pushedWriteIds).toEqual(run.expectedPushedWriteIds);
    expect(run.pendingOperationsCount).toBe(0);
    expect(run.forwardContainerIds).toContain('item-local-acl-recovery');
    expect(run.forwardContainerIds).toContain('root');
    expect(run.guardrailViolations).toHaveLength(1);
  });

  it('keeps corrected-checkpoint recovery signatures deterministic across seeds', async () => {
    const seeds = [1551, 1552, 1553] as const;

    for (const seed of seeds) {
      const firstRun = await runCorrectedCheckpointDeterministicScenario(seed);
      const secondRun = await runCorrectedCheckpointDeterministicScenario(seed);

      expect(secondRun).toEqual(firstRun);
      expect(firstRun.malformedHydrateError).toBe(
        'state.pendingOperations[1] has link childId that does not match itemId'
      );
      expect(firstRun.pageSignatures).toEqual(firstRun.expectedPageSignatures);
      expect(firstRun.pushedOpIds).toEqual(firstRun.expectedPushedOpIds);
      expect(firstRun.pushedWriteIds).toEqual(firstRun.expectedPushedWriteIds);
      expect(toStageCodeSignatures(firstRun.guardrailViolations)).toEqual([
        'hydrate:hydrateGuardrailViolation'
      ]);
    }
  });
});
