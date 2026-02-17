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
  pickTwoDistinct,
  readForwardContainerSignatures,
  readSeedContainerCursorOrThrow,
  toStageCodeReplicaSignatures
} from './sync-client-randomized-test-support.js';

export interface PendingCheckpointPaginationResult {
  expectedPushedOpIds: string[];
  expectedPushedWriteIds: number[];
  expectedPageSignatures: string[];
  expectedGuardrailSignatures: string[];
  pushedOpIds: string[];
  pushedWriteIds: number[];
  pageSignatures: string[];
  guardrailSignatures: string[];
  firstSyncError: string | null;
  secondSyncError: string | null;
}

export async function runPendingCheckpointPaginationScenario(
  seed: number
): Promise<PendingCheckpointPaginationResult> {
  const random = createDeterministicRandom(seed);
  const parentCandidates = ['root', 'archive', 'workspace'] as const;
  const [parentRecovered, parentLocal] = pickTwoDistinct(
    parentCandidates,
    random
  );

  const itemSeed = `item-seed-pending-${seed}`;
  const itemPhantom = `item-phantom-pending-${seed}`;
  const itemRecovered = `item-recovered-pending-${seed}`;
  const localAclItem = `item-local-acl-pending-${seed}`;
  const localLinkItem = `item-local-link-pending-${seed}`;
  const localAclOpId = `local-acl-op-${seed}`;
  const localLinkOpId = `local-link-op-${seed}`;

  const at = createSeededIsoTimestampFactory({
    baseIso: '2026-02-14T12:32:00.000Z',
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

  const pushedOpIds: string[] = [];
  const pushedWriteIds: number[] = [];
  const guardrailCollector = createGuardrailViolationCollector();
  const guardrailViolations = guardrailCollector.violations;

  const scriptedPullOperations = createCallCountedPullResolver({
    resolve: ({ callCount }) => {
      if (callCount === 1) {
        return {
          items: [
            buildAclAddSyncItem({
              opId: `seed-pending-${seed}-1`,
              occurredAt: at(0),
              itemId: itemSeed
            })
          ],
          hasMore: false,
          nextCursor: {
            changedAt: at(0),
            changeId: `seed-pending-${seed}-1`
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
              opId: `pull-fail-pending-${seed}-1`,
              occurredAt: at(1),
              itemId: itemPhantom
            })
          ],
          hasMore: false,
          nextCursor: {
            changedAt: at(1),
            changeId: `pull-fail-pending-${seed}-1`
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
              opId: `good-link-pending-${seed}-1`,
              itemId: itemRecovered,
              opType: 'link_add',
              principalType: null,
              principalId: null,
              accessLevel: null,
              parentId: parentRecovered,
              childId: itemRecovered,
              actorId: null,
              sourceTable: 'test',
              sourceId: `good-link-pending-${seed}-1`,
              occurredAt: at(2)
            }
          ],
          hasMore: false,
          nextCursor: {
            changedAt: at(2),
            changeId: `good-link-pending-${seed}-1`
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
                opId: localAclOpId,
                occurredAt: at(3),
                itemId: localAclItem
              }),
              principalType: 'group',
              principalId: `group-pending-${seed}`,
              accessLevel: 'write'
            }
          ],
          hasMore: false,
          nextCursor: {
            changedAt: at(3),
            changeId: localAclOpId
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
            opId: localLinkOpId,
            itemId: localLinkItem,
            opType: 'link_add',
            principalType: null,
            principalId: null,
            accessLevel: null,
            parentId: parentLocal,
            childId: localLinkItem,
            actorId: null,
            sourceTable: 'test',
            sourceId: localLinkOpId,
            occurredAt: at(4)
          }
        ],
        hasMore: false,
        nextCursor: {
          changedAt: at(4),
          changeId: localLinkOpId
        },
        lastReconciledWriteIds: {
          desktop: 8,
          mobile: 7
        }
      };
    }
  });

  const transport: VfsCrdtSyncTransport = {
    pushOperations: async (input) => {
      for (const operation of input.operations) {
        pushedOpIds.push(operation.opId);
        pushedWriteIds.push(operation.writeId);
      }
      return {
        results: input.operations.map((operation) => ({
          opId: operation.opId,
          status: 'applied' as const
        }))
      };
    },
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
    errorMessage: 'expected seed cursor before pending checkpoint scenario'
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

  activeClient.queueLocalOperation({
    opType: 'acl_add',
    opId: localAclOpId,
    itemId: localAclItem,
    principalType: 'group',
    principalId: `group-pending-${seed}`,
    accessLevel: 'write',
    occurredAt: at(1)
  });
  activeClient.queueLocalOperation({
    opType: 'link_add',
    opId: localLinkOpId,
    itemId: localLinkItem,
    parentId: parentLocal,
    childId: localLinkItem,
    occurredAt: at(1)
  });

  const midState = activeClient.exportState();
  activeClient = makeClient();
  activeClient.hydrateState(midState);

  await activeClient.flush();
  await activeClient.sync();

  const pageSignatures = readForwardContainerSignatures({
    client: activeClient,
    seedCursor,
    pageLimit: 1
  });

  const guardrailSignatures = toStageCodeReplicaSignatures(guardrailViolations);

  return {
    expectedPushedOpIds: [localAclOpId, localLinkOpId],
    expectedPushedWriteIds: [7, 8],
    expectedPageSignatures: [
      `${parentRecovered}|good-link-pending-${seed}-1`,
      `${localAclItem}|${localAclOpId}`,
      `${parentLocal}|${localLinkOpId}`
    ],
    expectedGuardrailSignatures: [
      'pull:lastWriteIdRegression:desktop',
      'reconcile:lastWriteIdRegression:mobile'
    ],
    pushedOpIds,
    pushedWriteIds,
    pageSignatures,
    guardrailSignatures,
    firstSyncError,
    secondSyncError
  };
}
