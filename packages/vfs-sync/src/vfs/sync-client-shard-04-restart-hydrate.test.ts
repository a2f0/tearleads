import { describe, expect, it } from 'vitest';
import { runShard04RestartHydrateScenario } from './sync-client-shard-04-restart-hydrate-test-support.js';

describe('VfsBackgroundSyncClient', () => {
  it('converges deterministic randomized io with in-loop restart hydration', async () => {
    const result = await runShard04RestartHydrateScenario();

    expect(result.restartHydrateCount).toBeGreaterThan(0);
    expect(result.restartFloorChecks).toBeGreaterThan(0);

    for (const snapshot of result.snapshots) {
      expect(snapshot.pendingOperations).toBe(0);
      expect(snapshot.nextLocalWriteId).toBeGreaterThanOrEqual(
        snapshot.replicaWriteId + 1
      );
    }
  });
});
