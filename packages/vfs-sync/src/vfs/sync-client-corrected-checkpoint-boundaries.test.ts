import { describe, expect, it } from 'vitest';
import { runCorrectedCheckpointBoundaryScenario } from './sync-client-corrected-checkpoint-boundaries-test-support.js';
import { toStageCodeSignatures } from './sync-client-randomized-test-support.js';

describe('VfsBackgroundSyncClient', () => {
  it('keeps corrected-checkpoint recovery stable across pull and container window pagination boundaries', async () => {
    const seeds = [1661, 1662] as const;
    const configs = [
      {
        pullLimit: 1,
        containerWindowLimit: 1
      },
      {
        pullLimit: 1,
        containerWindowLimit: 2
      },
      {
        pullLimit: 2,
        containerWindowLimit: 1
      },
      {
        pullLimit: 3,
        containerWindowLimit: 3
      }
    ] as const;

    for (const seed of seeds) {
      let expectedForwardSignatures: string[] | null = null;

      for (const config of configs) {
        const firstRun = await runCorrectedCheckpointBoundaryScenario({
          seed,
          pullLimit: config.pullLimit,
          containerWindowLimit: config.containerWindowLimit
        });
        const secondRun = await runCorrectedCheckpointBoundaryScenario({
          seed,
          pullLimit: config.pullLimit,
          containerWindowLimit: config.containerWindowLimit
        });

        expect(secondRun).toEqual(firstRun);
        expect(firstRun.malformedHydrateError).toContain(
          'state.pendingOperations[1] has link childId that does not match itemId'
        );
        expect(firstRun.pagedWindowSignatures).toEqual(
          firstRun.forwardSignatures
        );
        expect(firstRun.forwardSignatures).toEqual(
          firstRun.expectedForwardSignatures
        );
        expect(firstRun.pulledOpIds).toEqual(firstRun.expectedPulledOpIds);
        expect(new Set(firstRun.pulledOpIds).size).toBe(
          firstRun.pulledOpIds.length
        );
        expect(firstRun.pulledOpIds).not.toContain(firstRun.remoteSeedOpId);
        expect(toStageCodeSignatures(firstRun.guardrailViolations)).toEqual([
          'hydrate:hydrateGuardrailViolation'
        ]);

        if (!expectedForwardSignatures) {
          expectedForwardSignatures = firstRun.forwardSignatures;
        } else {
          expect(firstRun.forwardSignatures).toEqual(expectedForwardSignatures);
        }
      }
    }
  });
});
