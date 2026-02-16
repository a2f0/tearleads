import { describe, expect, it } from 'vitest';
import {
  VfsBackgroundSyncClient,
  type VfsCrdtSyncTransport
} from './sync-client.js';
import {
  buildAclAddSyncItem,
  createCallCountedPullResolver,
  createCallCountedReconcileResolver,
  createDeterministicRandom,
  createGuardrailViolationCollector,
  createSeededIsoTimestampFactory,
  pickOne,
  pickTwoDistinct,
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
      const random = createDeterministicRandom(seed);
      const parentCandidates = ['root', 'archive', 'workspace'] as const;
      const principalTypes = ['group', 'organization'] as const;
      const accessLevels = ['read', 'write', 'admin'] as const;
      const [parentOne, parentTwo] = pickTwoDistinct(parentCandidates, random);
      const principalType = pickOne(principalTypes, random);
      const accessLevel = pickOne(accessLevels, random);

      const itemSeed = `item-seed-rand-${seed}`;
      const itemPhantom = `item-phantom-rand-${seed}`;
      const itemGoodAcl = `item-good-acl-rand-${seed}`;
      const itemGoodLinkOne = `item-good-link-one-rand-${seed}`;
      const itemGoodLinkTwo = `item-good-link-two-rand-${seed}`;

      const at = createSeededIsoTimestampFactory({
        baseIso: '2026-02-14T12:30:00.000Z',
        seed
      });

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

          if (callCount === 3) {
            return {
              cursor: { ...reconcileInput.cursor },
              lastReconciledWriteIds: {
                ...reconcileInput.lastReconciledWriteIds,
                mobile: 6
              }
            };
          }

          if (callCount === 4) {
            return {
              cursor: { ...reconcileInput.cursor },
              lastReconciledWriteIds: {
                ...reconcileInput.lastReconciledWriteIds,
                mobile: 7
              }
            };
          }

          return {
            cursor: { ...reconcileInput.cursor },
            lastReconciledWriteIds: {
              ...reconcileInput.lastReconciledWriteIds,
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
            };
          }

          if (callCount === 2) {
            return {
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
            };
          }

          if (callCount === 3) {
            return {
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
            };
          }

          return {
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

      expect(pageSignatures).toEqual([
        `${parentOne}|good-link-${seed}-1`,
        `${itemGoodAcl}|good-acl-${seed}-1`,
        `${parentTwo}|good-link-${seed}-2`
      ]);
      expect(
        pageSignatures.some((signature) =>
          signature.startsWith(`${itemPhantom}|`)
        )
      ).toBe(false);
      expect(
        pageSignatures.some((signature) =>
          signature.endsWith(`|${seedCursor.changeId}`)
        )
      ).toBe(false);
      const guardrailSignatures =
        toStageCodeReplicaSignatures(guardrailViolations);
      expect(guardrailSignatures).toEqual([
        'pull:lastWriteIdRegression:desktop',
        'reconcile:lastWriteIdRegression:mobile'
      ]);

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
