import { describe, expect, it } from 'vitest';
import type { VfsCrdtSyncTransport } from './sync-client-test-support.js';
import {
  buildAclAddSyncItem,
  createCallCountedPullResolver,
  createCallCountedReconcileResolver,
  createGuardrailViolationCollector,
  expectLastWriteIdRegressionViolation,
  VfsBackgroundSyncClient
} from './sync-client-test-support.js';

describe('VfsBackgroundSyncClient', () => {
  it('recovers independently across adjacent pull and reconcile regression cycles without cross-path contamination', async () => {
    const scriptedReconcileState = createCallCountedReconcileResolver({
      resolve: ({ reconcileInput, callCount }) => {
        if (callCount === 1) {
          return {
            cursor: { ...reconcileInput.cursor },
            lastReconciledWriteIds: {
              ...reconcileInput.lastReconciledWriteIds,
              mobile: 5
            }
          };
        }

        if (callCount === 2) {
          return {
            cursor: { ...reconcileInput.cursor },
            lastReconciledWriteIds: {
              ...reconcileInput.lastReconciledWriteIds,
              mobile: 4
            }
          };
        }

        return {
          cursor: { ...reconcileInput.cursor },
          lastReconciledWriteIds: {
            ...reconcileInput.lastReconciledWriteIds,
            mobile: 6
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
                occurredAt: '2026-02-14T12:25:00.000Z',
                itemId: 'item-seed'
              })
            ],
            hasMore: false,
            nextCursor: {
              changedAt: '2026-02-14T12:25:00.000Z',
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
                opId: 'pull-regress',
                occurredAt: '2026-02-14T12:25:01.000Z',
                itemId: 'item-pull-regress-should-not-apply'
              })
            ],
            hasMore: false,
            nextCursor: {
              changedAt: '2026-02-14T12:25:01.000Z',
              changeId: 'pull-regress'
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
                opId: 'post-pull-recovery',
                occurredAt: '2026-02-14T12:25:02.000Z',
                itemId: 'item-post-pull-recovery'
              })
            ],
            hasMore: false,
            nextCursor: {
              changedAt: '2026-02-14T12:25:02.000Z',
              changeId: 'post-pull-recovery'
            },
            lastReconciledWriteIds: {
              desktop: 6,
              mobile: 5
            }
          };
        }

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
    expectLastWriteIdRegressionViolation({
      violations: guardrailViolations,
      stage: 'pull',
      replicaId: 'desktop',
      previousWriteId: 5,
      incomingWriteId: 4
    });
    expect(resumedClient.snapshot().acl).not.toContainEqual(
      expect.objectContaining({
        itemId: 'item-pull-regress-should-not-apply'
      })
    );

    await expect(resumedClient.sync()).rejects.toThrowError(
      /regressed lastReconciledWriteIds for replica mobile/
    );
    expectLastWriteIdRegressionViolation({
      violations: guardrailViolations,
      stage: 'reconcile',
      replicaId: 'mobile',
      previousWriteId: 5,
      incomingWriteId: 4
    });
    expect(resumedClient.snapshot().lastReconciledWriteIds).toEqual({
      desktop: 6,
      mobile: 5
    });
    expect(resumedClient.snapshot().cursor).toEqual({
      changedAt: '2026-02-14T12:25:02.000Z',
      changeId: 'post-pull-recovery'
    });

    const successfulRecovery = await resumedClient.sync();
    expect(successfulRecovery).toEqual({
      pulledOperations: 0,
      pullPages: 1
    });
    expect(resumedClient.snapshot().lastReconciledWriteIds).toEqual({
      desktop: 6,
      mobile: 6
    });
    expect(resumedClient.snapshot().cursor).toEqual({
      changedAt: '2026-02-14T12:25:02.000Z',
      changeId: 'post-pull-recovery'
    });
    expect(resumedClient.snapshot().acl).toContainEqual(
      expect.objectContaining({
        itemId: 'item-post-pull-recovery'
      })
    );

    expect(
      guardrailViolations.filter((violation) => violation.stage === 'pull')
    ).toHaveLength(1);
    expect(
      guardrailViolations.filter((violation) => violation.stage === 'reconcile')
    ).toHaveLength(1);
    expect(observedPullRequests[0]?.cursor).toBeNull();
    expect(observedPullRequests[1]?.cursor).toEqual({
      changedAt: '2026-02-14T12:25:00.000Z',
      changeId: 'seed-1'
    });
    expect(observedPullRequests[2]?.cursor).toEqual({
      changedAt: '2026-02-14T12:25:00.000Z',
      changeId: 'seed-1'
    });
    expect(observedPullRequests[3]?.cursor).toEqual({
      changedAt: '2026-02-14T12:25:02.000Z',
      changeId: 'post-pull-recovery'
    });
  });

  it('fails closed when transport regresses cursor with no items', async () => {
    let pullCount = 0;
    const guardrailViolations: Array<{
      code: string;
      stage: string;
      message: string;
    }> = [];
    const transport: VfsCrdtSyncTransport = {
      pushOperations: async () => ({
        results: []
      }),
      pullOperations: async () => {
        pullCount += 1;
        if (pullCount === 1) {
          return {
            items: [
              buildAclAddSyncItem({
                opId: 'desktop-1',
                occurredAt: '2026-02-14T12:14:00.000Z'
              })
            ],
            hasMore: false,
            nextCursor: {
              changedAt: '2026-02-14T12:14:00.000Z',
              changeId: 'desktop-1'
            },
            lastReconciledWriteIds: {
              desktop: 1
            }
          };
        }

        return {
          items: [],
          hasMore: false,
          nextCursor: {
            changedAt: '2026-02-14T12:13:59.000Z',
            changeId: 'desktop-0'
          },
          lastReconciledWriteIds: {
            desktop: 1
          }
        };
      }
    };

    const client = new VfsBackgroundSyncClient('user-1', 'desktop', transport, {
      onGuardrailViolation: (violation) => {
        guardrailViolations.push({
          code: violation.code,
          stage: violation.stage,
          message: violation.message
        });
      }
    });
    await client.sync();
    await expect(client.sync()).rejects.toThrowError(/regressing sync cursor/);
    expect(guardrailViolations).toContainEqual({
      code: 'pullCursorRegression',
      stage: 'pull',
      message: 'pull response regressed local sync cursor'
    });
  });
});
