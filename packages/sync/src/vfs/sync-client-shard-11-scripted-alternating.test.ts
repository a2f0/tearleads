import { describe, expect, it } from 'vitest';
import type { VfsCrdtSyncTransport } from './sync-client-test-support.js';
import {
  buildAclAddSyncItem,
  createCallCountedPullResolver,
  createCallCountedReconcileResolver,
  createGuardrailViolationCollector,
  expectContainerClocksMonotonic,
  expectLastWriteIdRegressionViolation,
  toContainerClockCursorMap,
  VfsBackgroundSyncClient
} from './sync-client-test-support.js';

describe('VfsBackgroundSyncClient', () => {
  it('converges after scripted alternating pull and reconcile failures with bounded guardrail telemetry', async () => {
    const scriptedReconcileState = createCallCountedReconcileResolver({
      resolve: ({ reconcileInput: input, callCount }) => {
        if (callCount === 1) {
          return {
            cursor: { ...input.cursor },
            lastReconciledWriteIds: {
              ...input.lastReconciledWriteIds,
              mobile: 5
            }
          };
        }

        if (callCount === 2) {
          return {
            cursor: { ...input.cursor },
            lastReconciledWriteIds: {
              ...input.lastReconciledWriteIds,
              mobile: 4
            }
          };
        }

        if (callCount === 3) {
          return {
            cursor: { ...input.cursor },
            lastReconciledWriteIds: {
              ...input.lastReconciledWriteIds,
              mobile: 6
            }
          };
        }

        return {
          cursor: { ...input.cursor },
          lastReconciledWriteIds: {
            ...input.lastReconciledWriteIds,
            desktop: 8,
            mobile: 8
          }
        };
      }
    });
    const guardrailCollector = createGuardrailViolationCollector();
    const guardrailViolations = guardrailCollector.violations;
    const observedPullRequests: Array<{
      cursor: { changedAt: string; changeId: string } | null;
      limit: number;
    }> = [];
    const scriptedPullOperations = createCallCountedPullResolver({
      resolve: ({ pullInput: input, callCount }) => {
        observedPullRequests.push({
          cursor: input.cursor ? { ...input.cursor } : null,
          limit: input.limit
        });

        if (callCount === 1) {
          return {
            items: [
              buildAclAddSyncItem({
                opId: 'seed-1',
                occurredAt: '2026-02-14T12:26:00.000Z',
                itemId: 'item-seed'
              })
            ],
            hasMore: false,
            nextCursor: {
              changedAt: '2026-02-14T12:26:00.000Z',
              changeId: 'seed-1'
            },
            lastReconciledWriteIds: {
              desktop: 5
            }
          };
        }

        if (callCount === 2) {
          return {
            items: [
              buildAclAddSyncItem({
                opId: 'pull-fail-a',
                occurredAt: '2026-02-14T12:26:01.000Z',
                itemId: 'item-pull-fail-a'
              })
            ],
            hasMore: false,
            nextCursor: {
              changedAt: '2026-02-14T12:26:01.000Z',
              changeId: 'pull-fail-a'
            },
            lastReconciledWriteIds: {
              desktop: 4,
              mobile: 5
            }
          };
        }

        if (callCount === 3) {
          return {
            items: [
              buildAclAddSyncItem({
                opId: 'cycle-b-1',
                occurredAt: '2026-02-14T12:26:02.000Z',
                itemId: 'item-cycle-b'
              })
            ],
            hasMore: false,
            nextCursor: {
              changedAt: '2026-02-14T12:26:02.000Z',
              changeId: 'cycle-b-1'
            },
            lastReconciledWriteIds: {
              desktop: 6,
              mobile: 5
            }
          };
        }

        if (callCount === 4) {
          return {
            items: [],
            hasMore: false,
            nextCursor: null,
            lastReconciledWriteIds: {
              desktop: 6,
              mobile: 5
            }
          };
        }

        if (callCount === 5) {
          return {
            items: [
              buildAclAddSyncItem({
                opId: 'pull-fail-d',
                occurredAt: '2026-02-14T12:26:03.000Z',
                itemId: 'item-pull-fail-d'
              })
            ],
            hasMore: false,
            nextCursor: {
              changedAt: '2026-02-14T12:26:03.000Z',
              changeId: 'pull-fail-d'
            },
            lastReconciledWriteIds: {
              desktop: 5,
              mobile: 6
            }
          };
        }

        if (callCount === 6) {
          return {
            items: [
              buildAclAddSyncItem({
                opId: 'cycle-e-1',
                occurredAt: '2026-02-14T12:26:04.000Z',
                itemId: 'item-cycle-e'
              })
            ],
            hasMore: false,
            nextCursor: {
              changedAt: '2026-02-14T12:26:04.000Z',
              changeId: 'cycle-e-1'
            },
            lastReconciledWriteIds: {
              desktop: 7,
              mobile: 6
            }
          };
        }

        return {
          items: [],
          hasMore: false,
          nextCursor: null,
          lastReconciledWriteIds: {
            desktop: 8,
            mobile: 8
          }
        };
      }
    });
    const transport: VfsCrdtSyncTransport = {
      pushOperations: async () => ({
        results: []
      }),
      pullOperations: (input) => scriptedPullOperations(input),
      reconcileState: (input) => scriptedReconcileState(input)
    };

    const seedClient = new VfsBackgroundSyncClient(
      'user-1',
      'desktop',
      transport,
      {
        pullLimit: 1,
        onGuardrailViolation: guardrailCollector.onGuardrailViolation
      }
    );
    await seedClient.sync();
    expect(seedClient.snapshot().lastReconciledWriteIds).toEqual({
      desktop: 5,
      mobile: 5
    });

    const resumedClient = new VfsBackgroundSyncClient(
      'user-1',
      'desktop',
      transport,
      {
        pullLimit: 1,
        onGuardrailViolation: guardrailCollector.onGuardrailViolation
      }
    );
    resumedClient.hydrateState(seedClient.exportState());

    await expect(resumedClient.sync()).rejects.toThrowError(
      /regressed lastReconciledWriteIds for replica desktop/
    );
    await expect(resumedClient.sync()).rejects.toThrowError(
      /regressed lastReconciledWriteIds for replica mobile/
    );
    const cycleC = await resumedClient.sync();
    expect(cycleC).toEqual({
      pulledOperations: 0,
      pullPages: 1
    });
    const cycleCClocks = resumedClient.snapshot().containerClocks;
    await expect(resumedClient.sync()).rejects.toThrowError(
      /regressed lastReconciledWriteIds for replica desktop/
    );
    const cycleE = await resumedClient.sync();
    expect(cycleE).toEqual({
      pulledOperations: 1,
      pullPages: 1
    });

    expectLastWriteIdRegressionViolation({
      violations: guardrailViolations,
      stage: 'pull',
      replicaId: 'desktop',
      previousWriteId: 5,
      incomingWriteId: 4
    });
    expectLastWriteIdRegressionViolation({
      violations: guardrailViolations,
      stage: 'reconcile',
      replicaId: 'mobile',
      previousWriteId: 5,
      incomingWriteId: 4
    });
    expectLastWriteIdRegressionViolation({
      violations: guardrailViolations,
      stage: 'pull',
      replicaId: 'desktop',
      previousWriteId: 6,
      incomingWriteId: 5
    });
    expect(guardrailViolations).toHaveLength(3);

    expect(resumedClient.snapshot().lastReconciledWriteIds).toEqual({
      desktop: 8,
      mobile: 8
    });
    expect(resumedClient.snapshot().cursor).toEqual({
      changedAt: '2026-02-14T12:26:04.000Z',
      changeId: 'cycle-e-1'
    });
    expect(resumedClient.snapshot().acl).toContainEqual(
      expect.objectContaining({
        itemId: 'item-cycle-b'
      })
    );
    expect(resumedClient.snapshot().acl).toContainEqual(
      expect.objectContaining({
        itemId: 'item-cycle-e'
      })
    );
    expect(resumedClient.snapshot().acl).not.toContainEqual(
      expect.objectContaining({
        itemId: 'item-pull-fail-a'
      })
    );
    expect(resumedClient.snapshot().acl).not.toContainEqual(
      expect.objectContaining({
        itemId: 'item-pull-fail-d'
      })
    );
    const finalClocks = resumedClient.snapshot().containerClocks;
    expectContainerClocksMonotonic(cycleCClocks, finalClocks);
    const finalClockMap = toContainerClockCursorMap(finalClocks);
    expect(finalClockMap.get('item-cycle-b')?.changeId).toBe('cycle-b-1');
    expect(finalClockMap.get('item-cycle-e')?.changeId).toBe('cycle-e-1');
    expect(finalClockMap.get('item-pull-fail-a')).toBeUndefined();
    expect(finalClockMap.get('item-pull-fail-d')).toBeUndefined();

    expect(observedPullRequests[0]?.cursor).toBeNull();
    expect(observedPullRequests[1]?.cursor).toEqual({
      changedAt: '2026-02-14T12:26:00.000Z',
      changeId: 'seed-1'
    });
    expect(observedPullRequests[2]?.cursor).toEqual({
      changedAt: '2026-02-14T12:26:00.000Z',
      changeId: 'seed-1'
    });
    expect(observedPullRequests[3]?.cursor).toEqual({
      changedAt: '2026-02-14T12:26:02.000Z',
      changeId: 'cycle-b-1'
    });
    expect(observedPullRequests[4]?.cursor).toEqual({
      changedAt: '2026-02-14T12:26:02.000Z',
      changeId: 'cycle-b-1'
    });
    expect(observedPullRequests[5]?.cursor).toEqual({
      changedAt: '2026-02-14T12:26:02.000Z',
      changeId: 'cycle-b-1'
    });
  });
});
