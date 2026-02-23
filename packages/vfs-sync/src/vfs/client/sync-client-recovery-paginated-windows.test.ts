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
  readForwardContainerSignatures,
  readSeedContainerCursorOrThrow
} from './sync-client-randomized-test-support.js';

describe('VfsBackgroundSyncClient', () => {
  it('keeps paginated container windows deterministic after alternating recovery failures', async () => {
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

        if (callCount === 4) {
          return {
            cursor: { ...input.cursor },
            lastReconciledWriteIds: {
              ...input.lastReconciledWriteIds,
              mobile: 7
            }
          };
        }

        return {
          cursor: { ...input.cursor },
          lastReconciledWriteIds: {
            ...input.lastReconciledWriteIds,
            mobile: 8
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
                opId: 'seed-paged-1',
                occurredAt: '2026-02-14T12:29:00.000Z',
                itemId: 'item-seed-paged'
              })
            ],
            hasMore: false,
            nextCursor: {
              changedAt: '2026-02-14T12:29:00.000Z',
              changeId: 'seed-paged-1'
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
                opId: 'pull-fail-paged-1',
                occurredAt: '2026-02-14T12:29:01.000Z',
                itemId: 'item-phantom-paged'
              })
            ],
            hasMore: false,
            nextCursor: {
              changedAt: '2026-02-14T12:29:01.000Z',
              changeId: 'pull-fail-paged-1'
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
                opId: 'good-link-root-paged',
                itemId: 'item-good-link-root-paged',
                opType: 'link_add',
                principalType: null,
                principalId: null,
                accessLevel: null,
                parentId: 'root',
                childId: 'item-good-link-root-paged',
                actorId: null,
                sourceTable: 'test',
                sourceId: 'good-link-root-paged',
                occurredAt: '2026-02-14T12:29:02.000Z'
              }
            ],
            hasMore: false,
            nextCursor: {
              changedAt: '2026-02-14T12:29:02.000Z',
              changeId: 'good-link-root-paged'
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
                opId: 'good-acl-paged',
                occurredAt: '2026-02-14T12:29:03.000Z',
                itemId: 'item-good-acl-paged'
              })
            ],
            hasMore: false,
            nextCursor: {
              changedAt: '2026-02-14T12:29:03.000Z',
              changeId: 'good-acl-paged'
            },
            lastReconciledWriteIds: {
              desktop: 7,
              mobile: 6
            }
          };
        }

        return {
          items: [
            {
              opId: 'good-link-archive-paged',
              itemId: 'item-good-link-archive-paged',
              opType: 'link_add',
              principalType: null,
              principalId: null,
              accessLevel: null,
              parentId: 'archive',
              childId: 'item-good-link-archive-paged',
              actorId: null,
              sourceTable: 'test',
              sourceId: 'good-link-archive-paged',
              occurredAt: '2026-02-14T12:29:04.000Z'
            }
          ],
          hasMore: false,
          nextCursor: {
            changedAt: '2026-02-14T12:29:04.000Z',
            changeId: 'good-link-archive-paged'
          },
          lastReconciledWriteIds: {
            desktop: 8,
            mobile: 7
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
      errorMessage: 'expected seed cursor for paginated window checks'
    });

    await expect(resumedClient.sync()).rejects.toThrowError(
      /regressed lastReconciledWriteIds for replica desktop/
    );
    await expect(resumedClient.sync()).rejects.toThrowError(
      /regressed lastReconciledWriteIds for replica mobile/
    );
    await resumedClient.sync();
    await resumedClient.sync();
    await resumedClient.sync();

    const pagedSignatures = readForwardContainerSignatures({
      client: resumedClient,
      seedCursor,
      pageLimit: 1
    });
    expect(pagedSignatures).toEqual([
      'root|good-link-root-paged',
      'item-good-acl-paged|good-acl-paged',
      'archive|good-link-archive-paged'
    ]);
    expect(
      pagedSignatures.some((signature) =>
        signature.startsWith('item-phantom-paged|')
      )
    ).toBe(false);
    expect(
      pagedSignatures.some((signature) =>
        signature.endsWith(`|${seedCursor.changeId}`)
      )
    ).toBe(false);

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
