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

export interface SeededRestartPaginationResult {
  expectedPageSignatures: string[];
  expectedGuardrailSignatures: string[];
  excludedPhantomSignature: string;
  pageSignatures: string[];
  guardrailSignatures: string[];
  firstSyncError: string | null;
  secondSyncError: string | null;
}

export async function runSeededRestartPaginationScenario(
  seed: number,
  withMidRestart: boolean
): Promise<SeededRestartPaginationResult> {
  const random = createDeterministicRandom(seed);
  const parentCandidates = ['root', 'archive', 'workspace'] as const;
  const principalTypes = ['group', 'organization'] as const;
  const accessLevels = ['read', 'write', 'admin'] as const;
  const [parentOne, parentTwo] = pickTwoDistinct(parentCandidates, random);
  const principalType = pickOne(principalTypes, random);
  const accessLevel = pickOne(accessLevels, random);

  const itemSeed = `item-seed-mid-${seed}`;
  const itemPhantom = `item-phantom-mid-${seed}`;
  const itemGoodAcl = `item-good-acl-mid-${seed}`;
  const itemGoodLinkOne = `item-good-link-one-mid-${seed}`;
  const itemGoodLinkTwo = `item-good-link-two-mid-${seed}`;

  const at = createSeededIsoTimestampFactory({
    baseIso: '2026-02-14T12:31:00.000Z',
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
              opId: `seed-mid-${seed}-1`,
              occurredAt: at(0),
              itemId: itemSeed
            })
          ],
          hasMore: false,
          nextCursor: {
            changedAt: at(0),
            changeId: `seed-mid-${seed}-1`
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
              opId: `pull-fail-mid-${seed}-1`,
              occurredAt: at(1),
              itemId: itemPhantom
            })
          ],
          hasMore: false,
          nextCursor: {
            changedAt: at(1),
            changeId: `pull-fail-mid-${seed}-1`
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
              opId: `good-link-mid-${seed}-1`,
              itemId: itemGoodLinkOne,
              opType: 'link_add',
              principalType: null,
              principalId: null,
              accessLevel: null,
              parentId: parentOne,
              childId: itemGoodLinkOne,
              actorId: null,
              sourceTable: 'test',
              sourceId: `good-link-mid-${seed}-1`,
              occurredAt: at(2)
            }
          ],
          hasMore: false,
          nextCursor: {
            changedAt: at(2),
            changeId: `good-link-mid-${seed}-1`
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
                opId: `good-acl-mid-${seed}-1`,
                occurredAt: at(3),
                itemId: itemGoodAcl
              }),
              principalType,
              principalId: `${principalType}-mid-${seed}`,
              accessLevel
            }
          ],
          hasMore: false,
          nextCursor: {
            changedAt: at(3),
            changeId: `good-acl-mid-${seed}-1`
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
            opId: `good-link-mid-${seed}-2`,
            itemId: itemGoodLinkTwo,
            opType: 'link_add',
            principalType: null,
            principalId: null,
            accessLevel: null,
            parentId: parentTwo,
            childId: itemGoodLinkTwo,
            actorId: null,
            sourceTable: 'test',
            sourceId: `good-link-mid-${seed}-2`,
            occurredAt: at(4)
          }
        ],
        hasMore: false,
        nextCursor: {
          changedAt: at(4),
          changeId: `good-link-mid-${seed}-2`
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

  const makeClient = (): VfsBackgroundSyncClient =>
    new VfsBackgroundSyncClient('user-1', 'desktop', transport, {
      pullLimit: 1,
      onGuardrailViolation: guardrailCollector.onGuardrailViolation
    });

  const seedClient = makeClient();
  await seedClient.sync();

  let activeClient = makeClient();
  activeClient.hydrateState(seedClient.exportState());

  const seedCursor = readSeedContainerCursorOrThrow({
    client: activeClient,
    pageLimit: 10,
    errorMessage: 'expected seed cursor before mid-chain continuation'
  });

  let firstSyncError: string | null = null;
  try {
    await activeClient.sync();
  } catch (error) {
    firstSyncError = error instanceof Error ? error.message : String(error);
  }

  let secondSyncError: string | null = null;
  try {
    await activeClient.sync();
  } catch (error) {
    secondSyncError = error instanceof Error ? error.message : String(error);
  }

  await activeClient.sync();

  if (withMidRestart) {
    const midState = activeClient.exportState();
    activeClient = makeClient();
    activeClient.hydrateState(midState);
  }

  await activeClient.sync();
  await activeClient.sync();

  const pageSignatures = readForwardContainerSignatures({
    client: activeClient,
    seedCursor,
    pageLimit: 1
  });

  return {
    expectedPageSignatures: [
      `${parentOne}|good-link-mid-${seed}-1`,
      `${itemGoodAcl}|good-acl-mid-${seed}-1`,
      `${parentTwo}|good-link-mid-${seed}-2`
    ],
    expectedGuardrailSignatures: [
      'pull:lastWriteIdRegression:desktop',
      'reconcile:lastWriteIdRegression:mobile'
    ],
    excludedPhantomSignature: `${itemPhantom}|pull-fail-mid-${seed}-1`,
    pageSignatures,
    guardrailSignatures: toStageCodeReplicaSignatures(guardrailViolations),
    firstSyncError,
    secondSyncError
  };
}
