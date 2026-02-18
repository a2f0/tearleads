import { describe, expect, it } from 'vitest';
import {
  VfsBackgroundSyncClient,
  type VfsCrdtSyncTransport
} from './sync-client.js';
import {
  buildAclAddSyncItem,
  buildMixedRecoveryExpectedSignatures,
  createCallCountedPullResolverFromPages,
  createCallCountedReconcileResolverFromWriteIds,
  createGuardrailViolationCollector,
  createSeededMixedRecoveryInputBundle,
  readForwardContainerSignatures,
  readSeedContainerCursorOrThrow,
  toStageCodeReplicaSignatures
} from './sync-client-randomized-test-support.js';

describe('VfsBackgroundSyncClient', () => {
  it('keeps deterministic paginated container windows across randomized mixed recovery seeds', async () => {
    const runScenario = async (
      seed: number
    ): Promise<{
      pageSignatures: string[];
      guardrailSignatures: string[];
    }> => {
      const { parentOne, parentTwo, principalType, accessLevel, at } =
        createSeededMixedRecoveryInputBundle({
          seed,
          baseIso: '2026-02-14T12:30:00.000Z'
        });

      const itemSeed = `item-seed-rand-${seed}`;
      const itemPhantom = `item-phantom-rand-${seed}`;
      const itemGoodAcl = `item-good-acl-rand-${seed}`;
      const itemGoodLinkOne = `item-good-link-one-rand-${seed}`;
      const itemGoodLinkTwo = `item-good-link-two-rand-${seed}`;
      const expectedSignatures = buildMixedRecoveryExpectedSignatures({
        firstParentId: parentOne,
        firstChangeId: `good-link-${seed}-1`,
        middleContainerId: itemGoodAcl,
        middleChangeId: `good-acl-${seed}-1`,
        secondParentId: parentTwo,
        secondChangeId: `good-link-${seed}-2`,
        phantomContainerId: itemPhantom,
        phantomChangeId: `pull-fail-${seed}-1`
      });

      const scriptedReconcileState =
        createCallCountedReconcileResolverFromWriteIds({
          writeIds: [5, 4, 6, 7, 8]
        });
      const guardrailCollector = createGuardrailViolationCollector();
      const guardrailViolations = guardrailCollector.violations;
      const scriptedPullOperations = createCallCountedPullResolverFromPages({
        pages: [
          {
            items: [
              buildAclAddSyncItem({
                opId: `seed-${seed}-1`,
                occurredAt: at(0),
                itemId: itemSeed
              })
            ],
            hasMore: false,
            nextCursor: {
              changedAt: at(0),
              changeId: `seed-${seed}-1`
            },
            lastReconciledWriteIds: {
              desktop: 5
            }
          },
          {
            items: [
              buildAclAddSyncItem({
                opId: `pull-fail-${seed}-1`,
                occurredAt: at(1),
                itemId: itemPhantom
              })
            ],
            hasMore: false,
            nextCursor: {
              changedAt: at(1),
              changeId: `pull-fail-${seed}-1`
            },
            lastReconciledWriteIds: {
              desktop: 4,
              mobile: 5
            }
          },
          {
            items: [
              {
                opId: `good-link-${seed}-1`,
                itemId: itemGoodLinkOne,
                opType: 'link_add',
                principalType: null,
                principalId: null,
                accessLevel: null,
                parentId: parentOne,
                childId: itemGoodLinkOne,
                actorId: null,
                sourceTable: 'test',
                sourceId: `good-link-${seed}-1`,
                occurredAt: at(2)
              }
            ],
            hasMore: false,
            nextCursor: {
              changedAt: at(2),
              changeId: `good-link-${seed}-1`
            },
            lastReconciledWriteIds: {
              desktop: 6,
              mobile: 5
            }
          },
          {
            items: [],
            hasMore: false,
            nextCursor: null,
            lastReconciledWriteIds: {
              desktop: 6,
              mobile: 5
            }
          },
          {
            items: [
              {
                ...buildAclAddSyncItem({
                  opId: `good-acl-${seed}-1`,
                  occurredAt: at(3),
                  itemId: itemGoodAcl
                }),
                principalType,
                principalId: `${principalType}-${seed}`,
                accessLevel
              }
            ],
            hasMore: false,
            nextCursor: {
              changedAt: at(3),
              changeId: `good-acl-${seed}-1`
            },
            lastReconciledWriteIds: {
              desktop: 7,
              mobile: 6
            }
          },
          {
            items: [
              {
                opId: `good-link-${seed}-2`,
                itemId: itemGoodLinkTwo,
                opType: 'link_add',
                principalType: null,
                principalId: null,
                accessLevel: null,
                parentId: parentTwo,
                childId: itemGoodLinkTwo,
                actorId: null,
                sourceTable: 'test',
                sourceId: `good-link-${seed}-2`,
                occurredAt: at(4)
              }
            ],
            hasMore: false,
            nextCursor: {
              changedAt: at(4),
              changeId: `good-link-${seed}-2`
            },
            lastReconciledWriteIds: {
              desktop: 8,
              mobile: 7
            }
          }
        ]
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
        errorMessage: 'expected seed cursor before randomized pagination'
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

      const pageSignatures = readForwardContainerSignatures({
        client: resumedClient,
        seedCursor,
        pageLimit: 1
      });

      expect(pageSignatures).toEqual(expectedSignatures.expectedPageSignatures);
      expect(
        pageSignatures.some(
          (signature) =>
            signature === expectedSignatures.excludedPhantomSignature
        )
      ).toBe(false);
      expect(
        pageSignatures.some((signature) =>
          signature.endsWith(`|${seedCursor.changeId}`)
        )
      ).toBe(false);
      const guardrailSignatures =
        toStageCodeReplicaSignatures(guardrailViolations);
      expect(guardrailSignatures).toEqual(
        expectedSignatures.expectedGuardrailSignatures
      );

      return {
        pageSignatures,
        guardrailSignatures
      };
    };

    const seeds = [1224, 1225, 1226] as const;
    for (const seed of seeds) {
      const firstRun = await runScenario(seed);
      const secondRun = await runScenario(seed);
      expect(secondRun).toEqual(firstRun);
    }
  });
});
