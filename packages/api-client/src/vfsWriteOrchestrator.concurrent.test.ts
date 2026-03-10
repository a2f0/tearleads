import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

describe('vfsWriteOrchestrator concurrent protocol runs', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    vi.stubEnv('VITE_API_URL', 'http://localhost');
    global.fetch = vi.fn();
    localStorage.clear();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    global.fetch = originalFetch;
  });

  it('serializes syncCrdt and flushAll protocol runs', async () => {
    let pullCount = 0;
    let firstPullStarted = false;
    let secondPullStarted = false;
    let releaseFirstPull: (() => void) | null = null;
    let releaseSecondPull: (() => void) | null = null;
    const firstPullGate = new Promise<void>((resolve) => {
      releaseFirstPull = resolve;
    });
    const secondPullGate = new Promise<void>((resolve) => {
      releaseSecondPull = resolve;
    });

    const pullResponse = {
      items: [
        {
          opId: 'remote-orch-1',
          itemId: 'item-orch-1',
          opType: 'acl_add' as const,
          principalType: 'group' as const,
          principalId: 'group-1',
          accessLevel: 'read' as const,
          parentId: null,
          childId: null,
          actorId: 'remote',
          sourceTable: 'vfs_acl',
          sourceId: 'acl-1',
          occurredAt: '2026-02-18T00:00:00.000Z'
        }
      ],
      hasMore: false,
      nextCursor: {
        changedAt: '2026-02-18T00:00:00.000Z',
        changeId: 'remote-orch-1'
      },
      lastReconciledWriteIds: {}
    };

    const pullOperations = vi.fn(async () => {
      pullCount += 1;
      if (pullCount === 1) {
        firstPullStarted = true;
        await firstPullGate;
        return pullResponse;
      }

      secondPullStarted = true;
      await secondPullGate;
      return pullResponse;
    });

    const pushOperations = vi.fn(async () => ({ results: [] }));
    const reconcileState = vi.fn(
      async ({ cursor, lastReconciledWriteIds }) => ({
        cursor,
        lastReconciledWriteIds
      })
    );

    const waitForCondition = async (
      condition: () => boolean,
      timeoutMs = 1000
    ): Promise<void> => {
      const startMs = Date.now();
      while (!condition()) {
        if (Date.now() - startMs >= timeoutMs) {
          throw new Error('condition was not met within timeout');
        }
        await new Promise((resolve) => {
          setTimeout(resolve, 5);
        });
      }
    };

    const { VfsWriteOrchestrator } = await import('./vfsWriteOrchestrator');
    const orchestrator = new VfsWriteOrchestrator('user-1', 'desktop', {
      crdt: {
        transport: {
          pushOperations,
          pullOperations,
          reconcileState
        }
      }
    });

    const syncPromise = orchestrator.syncCrdt();
    await waitForCondition(() => firstPullStarted);
    const flushPromise = orchestrator.flushAll();

    await new Promise((resolve) => {
      setTimeout(resolve, 20);
    });
    expect(secondPullStarted).toBe(false);

    if (!releaseFirstPull) {
      throw new Error('missing first pull release hook');
    }
    releaseFirstPull();
    await expect(syncPromise).resolves.toEqual({
      pulledOperations: 1,
      pullPages: 1
    });

    await waitForCondition(() => secondPullStarted);
    if (!releaseSecondPull) {
      throw new Error('missing second pull release hook');
    }
    releaseSecondPull();

    await expect(flushPromise).resolves.toEqual({
      crdt: {
        pushedOperations: 0,
        pulledOperations: 0,
        pullPages: 1
      },
      blob: {
        processedOperations: 0,
        pendingOperations: 0
      }
    });
    expect(pullOperations).toHaveBeenCalledTimes(2);
  });
});
