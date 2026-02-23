import { describe, expect, it } from 'vitest';
import { compareVfsSyncCursorOrder } from '../protocol/sync-reconcile.js';
import {
  VfsBackgroundSyncClient,
  type VfsCrdtSyncTransport
} from './sync-client.js';
import {
  buildAclAddSyncItem,
  createCallCountedPullResolver,
  createCallCountedReconcileResolver,
  createGuardrailViolationCollector,
  expectLastWriteIdRegressionViolation,
  readSeedContainerCursorOrThrow
} from './sync-client-randomized-test-support.js';

describe('VfsBackgroundSyncClient', () => {
  it('keeps listChangedContainers strictly forward after recovery cycles and excludes failed-cycle phantom containers', async () => {
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
            mobile: 7
          }
        };
      }
    });
    const guardrailCollector = createGuardrailViolationCollector();
    const guardrailViolations = guardrailCollector.violations;
    const scriptedPullOperations = createCallCountedPullResolver({
      resolve: ({ callCount }) => {
        if (callCount === 1) {
          return {
            items: [
              buildAclAddSyncItem({
                opId: 'seed-1',
                occurredAt: '2026-02-14T12:27:00.000Z',
                itemId: 'item-seed-forward'
              })
            ],
            hasMore: false,
            nextCursor: {
              changedAt: '2026-02-14T12:27:00.000Z',
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
                opId: 'pull-fail-1',
                occurredAt: '2026-02-14T12:27:01.000Z',
                itemId: 'item-fail-phantom'
              })
            ],
            hasMore: false,
            nextCursor: {
              changedAt: '2026-02-14T12:27:01.000Z',
              changeId: 'pull-fail-1'
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
                opId: 'good-1',
                occurredAt: '2026-02-14T12:27:02.000Z',
                itemId: 'item-good-1'
              })
            ],
            hasMore: false,
            nextCursor: {
              changedAt: '2026-02-14T12:27:02.000Z',
              changeId: 'good-1'
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

        return {
          items: [
            buildAclAddSyncItem({
              opId: 'good-2',
              occurredAt: '2026-02-14T12:27:03.000Z',
              itemId: 'item-good-2'
            })
          ],
          hasMore: false,
          nextCursor: {
            changedAt: '2026-02-14T12:27:03.000Z',
            changeId: 'good-2'
          },
          lastReconciledWriteIds: {
            desktop: 7,
            mobile: 6
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

    const seedCursor = readSeedContainerCursorOrThrow({
      client: resumedClient,
      pageLimit: 10,
      errorMessage: 'expected seed cursor before forward-window assertions'
    });

    await expect(resumedClient.sync()).rejects.toThrowError(
      /regressed lastReconciledWriteIds for replica desktop/
    );
    await expect(resumedClient.sync()).rejects.toThrowError(
      /regressed lastReconciledWriteIds for replica mobile/
    );
    await resumedClient.sync();
    await resumedClient.sync();

    const forwardPage = resumedClient.listChangedContainers(seedCursor, 10);
    const forwardContainerIds = forwardPage.items.map(
      (item) => item.containerId
    );
    expect(forwardContainerIds).toContain('item-good-1');
    expect(forwardContainerIds).toContain('item-good-2');
    expect(forwardContainerIds).not.toContain('item-fail-phantom');
    for (const item of forwardPage.items) {
      expect(
        compareVfsSyncCursorOrder(
          {
            changedAt: item.changedAt,
            changeId: item.changeId
          },
          seedCursor
        )
      ).toBeGreaterThan(0);
    }

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
    expect(guardrailViolations).toHaveLength(2);
  });
});
