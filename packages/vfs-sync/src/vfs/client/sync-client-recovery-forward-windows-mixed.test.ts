import { describe, expect, it } from 'vitest';
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
import { compareVfsSyncCursorOrder } from '../protocol/sync-reconcile.js';

describe('VfsBackgroundSyncClient', () => {
  it('keeps mixed acl/link container windows strictly forward after alternating failure recoveries', async () => {
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
                opId: 'seed-mixed-1',
                occurredAt: '2026-02-14T12:28:00.000Z',
                itemId: 'item-seed-mixed'
              })
            ],
            hasMore: false,
            nextCursor: {
              changedAt: '2026-02-14T12:28:00.000Z',
              changeId: 'seed-mixed-1'
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
                opId: 'pull-fail-mixed-1',
                occurredAt: '2026-02-14T12:28:01.000Z',
                itemId: 'item-fail-phantom-mixed'
              })
            ],
            hasMore: false,
            nextCursor: {
              changedAt: '2026-02-14T12:28:01.000Z',
              changeId: 'pull-fail-mixed-1'
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
              {
                opId: 'good-link-1',
                itemId: 'item-good-link',
                opType: 'link_add',
                principalType: null,
                principalId: null,
                accessLevel: null,
                parentId: 'root',
                childId: 'item-good-link',
                actorId: null,
                sourceTable: 'test',
                sourceId: 'good-link-1',
                occurredAt: '2026-02-14T12:28:02.000Z'
              }
            ],
            hasMore: false,
            nextCursor: {
              changedAt: '2026-02-14T12:28:02.000Z',
              changeId: 'good-link-1'
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
              opId: 'good-acl-2',
              occurredAt: '2026-02-14T12:28:03.000Z',
              itemId: 'item-good-acl'
            })
          ],
          hasMore: false,
          nextCursor: {
            changedAt: '2026-02-14T12:28:03.000Z',
            changeId: 'good-acl-2'
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
      errorMessage: 'expected seed cursor before mixed forward-window checks'
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
    expect(forwardContainerIds).toContain('root');
    expect(forwardContainerIds).toContain('item-good-acl');
    expect(forwardContainerIds).not.toContain('item-fail-phantom-mixed');
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

    expect(resumedClient.snapshot().links).toContainEqual(
      expect.objectContaining({
        parentId: 'root',
        childId: 'item-good-link'
      })
    );
    expect(resumedClient.snapshot().acl).toContainEqual(
      expect.objectContaining({
        itemId: 'item-good-acl'
      })
    );
    expect(resumedClient.snapshot().acl).not.toContainEqual(
      expect.objectContaining({
        itemId: 'item-fail-phantom-mixed'
      })
    );

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
