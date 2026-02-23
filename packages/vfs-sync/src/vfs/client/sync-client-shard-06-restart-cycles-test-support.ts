import type { VfsCrdtSyncTransport } from './sync-client-test-support.js';
import {
  compareVfsSyncCursorOrder,
  createDeterministicRandom,
  InMemoryVfsCrdtSyncServer,
  InMemoryVfsCrdtSyncTransport,
  nextInt,
  pickOne,
  VfsBackgroundSyncClient
} from './sync-client-test-support.js';

interface CycleMetric {
  cycleStartWriteId: number;
  pushedWriteIds: number[];
  nextLocalWriteId: number;
  desktopLastReconciledWriteId: number;
  firstPushedOccurredAtMs: number;
  secondPushedOccurredAtMs: number;
  persistedCursorMs: number;
}

interface CursorValue {
  changedAt: string;
  changeId: string;
}

interface RestartCycleResult {
  cyclePushWriteIds: number[][];
  cycleMetrics: CycleMetric[];
  cycleCursors: CursorValue[];
  guardrailViolations: Array<{
    code: string;
    stage: string;
    message: string;
  }>;
}

interface LagRestartCycleResult extends RestartCycleResult {
  replayAlignedAfterFlush: boolean[];
}

export async function runThreeCycleAlternatingReconcileScenario(): Promise<RestartCycleResult> {
  const server = new InMemoryVfsCrdtSyncServer();
  await server.pushOperations({
    operations: [
      {
        opId: 'remote-1',
        opType: 'acl_add',
        itemId: 'item-three-cycle-seed',
        replicaId: 'remote',
        writeId: 1,
        occurredAt: '2026-02-14T14:27:00.000Z',
        principalType: 'group',
        principalId: 'group-seed',
        accessLevel: 'read'
      }
    ]
  });

  const baseTransport = new InMemoryVfsCrdtSyncTransport(server);
  const seedClient = new VfsBackgroundSyncClient(
    'user-1',
    'desktop',
    baseTransport
  );
  await seedClient.sync();

  const random = createDeterministicRandom(1222);
  const parentIds = ['root', 'archive'];
  const aclPrincipalTypes = ['group', 'organization'];
  const aclAccessLevels = ['read', 'write', 'admin'];
  const cycleWriteIdStarts = [10, 16, 23];
  const reconcileModes = ['ahead', 'equal', 'ahead'];
  const cyclePushWriteIds: number[][] = [];
  const cycleMetrics: CycleMetric[] = [];
  const cycleCursors: CursorValue[] = [];
  const guardrailViolations: Array<{
    code: string;
    stage: string;
    message: string;
  }> = [];

  let activeClient = seedClient;

  for (const [index, cycleStartWriteId] of cycleWriteIdStarts.entries()) {
    const persisted = activeClient.exportState();
    const replayCursor = persisted.replaySnapshot.cursor;
    if (!replayCursor) {
      throw new Error(`expected replay cursor before cycle ${index + 1}`);
    }

    const reconcileMode = reconcileModes[index];
    if (reconcileMode === 'ahead') {
      const replayCursorMs = Date.parse(replayCursor.changedAt);
      const aheadCursorMs = Number.isFinite(replayCursorMs)
        ? replayCursorMs + 2_000
        : Date.parse('2026-02-14T14:27:10.000Z') + index;
      persisted.reconcileState = {
        cursor: {
          changedAt: new Date(aheadCursorMs).toISOString(),
          changeId: `remote-cycle-${index + 2}`
        },
        lastReconciledWriteIds: {
          desktop: Math.max(0, cycleStartWriteId - 3)
        }
      };
    } else {
      persisted.reconcileState = {
        cursor: replayCursor,
        lastReconciledWriteIds: {
          desktop: Math.max(0, cycleStartWriteId - 3)
        }
      };
    }

    const opVariant = nextInt(random, 0, 1);
    const itemId = `item-three-cycle-${index + 1}`;
    const firstOccurredAt = new Date(
      Date.parse('2026-02-14T14:26:40.000Z') - index * 1_000
    ).toISOString();
    const secondOccurredAt = new Date(
      Date.parse('2026-02-14T14:26:39.000Z') - index * 1_000
    ).toISOString();
    const aclPrincipalType = pickOne(aclPrincipalTypes, random);
    const aclPrincipalId = `${aclPrincipalType}-${index + 1}`;
    const aclAccessLevel = pickOne(aclAccessLevels, random);
    const parentId = pickOne(parentIds, random);

    persisted.pendingOperations =
      opVariant === 0
        ? [
            {
              opId: `desktop-${cycleStartWriteId}`,
              opType: 'acl_add',
              itemId,
              replicaId: 'desktop',
              writeId: cycleStartWriteId,
              occurredAt: firstOccurredAt,
              principalType: aclPrincipalType,
              principalId: aclPrincipalId,
              accessLevel: aclAccessLevel
            },
            {
              opId: `desktop-${cycleStartWriteId + 1}`,
              opType: 'link_add',
              itemId,
              replicaId: 'desktop',
              writeId: cycleStartWriteId + 1,
              occurredAt: secondOccurredAt,
              parentId,
              childId: itemId
            }
          ]
        : [
            {
              opId: `desktop-${cycleStartWriteId}`,
              opType: 'link_remove',
              itemId,
              replicaId: 'desktop',
              writeId: cycleStartWriteId,
              occurredAt: firstOccurredAt,
              parentId,
              childId: itemId
            },
            {
              opId: `desktop-${cycleStartWriteId + 1}`,
              opType: 'acl_remove',
              itemId,
              replicaId: 'desktop',
              writeId: cycleStartWriteId + 1,
              occurredAt: secondOccurredAt,
              principalType: aclPrincipalType,
              principalId: aclPrincipalId
            }
          ];
    persisted.nextLocalWriteId = 1;

    const pushedWriteIds: number[] = [];
    const pushedOccurredAtMs: number[] = [];
    const transport: VfsCrdtSyncTransport = {
      pushOperations: async (input) => {
        for (const operation of input.operations) {
          pushedWriteIds.push(operation.writeId);
          pushedOccurredAtMs.push(Date.parse(operation.occurredAt));
        }
        return baseTransport.pushOperations(input);
      },
      pullOperations: (input) => baseTransport.pullOperations(input)
    };

    const resumedClient = new VfsBackgroundSyncClient(
      'user-1',
      'desktop',
      transport,
      {
        onGuardrailViolation: (violation) => {
          guardrailViolations.push({
            code: violation.code,
            stage: violation.stage,
            message: violation.message
          });
        }
      }
    );

    resumedClient.hydrateState(persisted);
    await resumedClient.flush();

    const firstPushedOccurredAtMs = pushedOccurredAtMs[0];
    const secondPushedOccurredAtMs = pushedOccurredAtMs[1];
    if (
      firstPushedOccurredAtMs === undefined ||
      secondPushedOccurredAtMs === undefined
    ) {
      throw new Error(`expected pushed timestamps for cycle ${index + 1}`);
    }

    const cycleCursor = resumedClient.snapshot().cursor;
    if (!cycleCursor) {
      throw new Error(`expected cycle cursor for cycle ${index + 1}`);
    }

    const persistedCursor = persisted.reconcileState?.cursor ?? replayCursor;
    cyclePushWriteIds.push([...pushedWriteIds]);
    cycleMetrics.push({
      cycleStartWriteId,
      pushedWriteIds: [...pushedWriteIds],
      nextLocalWriteId: resumedClient.snapshot().nextLocalWriteId,
      desktopLastReconciledWriteId:
        resumedClient.snapshot().lastReconciledWriteIds.desktop ?? 0,
      firstPushedOccurredAtMs,
      secondPushedOccurredAtMs,
      persistedCursorMs: Date.parse(persistedCursor.changedAt)
    });
    cycleCursors.push({
      changedAt: cycleCursor.changedAt,
      changeId: cycleCursor.changeId
    });

    activeClient = resumedClient;
  }

  return {
    cyclePushWriteIds,
    cycleMetrics,
    cycleCursors,
    guardrailViolations
  };
}

export async function runReplayAlignedLagRestartCycleScenario(): Promise<LagRestartCycleResult> {
  const server = new InMemoryVfsCrdtSyncServer();
  await server.pushOperations({
    operations: [
      {
        opId: 'remote-1',
        opType: 'acl_add',
        itemId: 'item-lag-cycle-seed',
        replicaId: 'remote',
        writeId: 1,
        occurredAt: '2026-02-14T14:29:00.000Z',
        principalType: 'group',
        principalId: 'group-seed',
        accessLevel: 'read'
      }
    ]
  });

  const baseTransport = new InMemoryVfsCrdtSyncTransport(server);
  const seedClient = new VfsBackgroundSyncClient(
    'user-1',
    'desktop',
    baseTransport
  );
  await seedClient.sync();

  const random = createDeterministicRandom(1223);
  const parentIds = ['root', 'archive'];
  const principalTypes = ['group', 'organization'];
  const accessLevels = ['read', 'write', 'admin'];
  const cycleWriteIdStarts = [12, 20, 29];
  const cyclePushWriteIds: number[][] = [];
  const cycleMetrics: CycleMetric[] = [];
  const cycleCursors: CursorValue[] = [];
  const replayAlignedAfterFlush: boolean[] = [];
  const guardrailViolations: Array<{
    code: string;
    stage: string;
    message: string;
  }> = [];

  let activeClient = seedClient;

  for (const [index, cycleStartWriteId] of cycleWriteIdStarts.entries()) {
    const persisted = activeClient.exportState();
    const replayCursor = persisted.replaySnapshot.cursor;
    if (!replayCursor) {
      throw new Error(`expected replay cursor before cycle ${index + 1}`);
    }

    persisted.reconcileState = {
      cursor: replayCursor,
      lastReconciledWriteIds: {
        desktop: Math.max(0, cycleStartWriteId - 7)
      }
    };

    const itemId = `item-lag-cycle-${index + 1}`;
    const principalType = pickOne(principalTypes, random);
    const principalId = `${principalType}-lag-${index + 1}`;
    const accessLevel = pickOne(accessLevels, random);
    const parentId = pickOne(parentIds, random);
    const firstOccurredAt = new Date(
      Date.parse('2026-02-14T14:28:40.000Z') - index * 1_000
    ).toISOString();
    const secondOccurredAt = new Date(
      Date.parse('2026-02-14T14:28:39.000Z') - index * 1_000
    ).toISOString();

    persisted.pendingOperations = [
      {
        opId: `desktop-${cycleStartWriteId}`,
        opType: 'acl_add',
        itemId,
        replicaId: 'desktop',
        writeId: cycleStartWriteId,
        occurredAt: firstOccurredAt,
        principalType,
        principalId,
        accessLevel
      },
      {
        opId: `desktop-${cycleStartWriteId + 1}`,
        opType: 'link_add',
        itemId,
        replicaId: 'desktop',
        writeId: cycleStartWriteId + 1,
        occurredAt: secondOccurredAt,
        parentId,
        childId: itemId
      }
    ];
    persisted.nextLocalWriteId = 1;

    const pushedWriteIds: number[] = [];
    const pushedOccurredAtMs: number[] = [];
    const transport: VfsCrdtSyncTransport = {
      pushOperations: async (input) => {
        for (const operation of input.operations) {
          pushedWriteIds.push(operation.writeId);
          pushedOccurredAtMs.push(Date.parse(operation.occurredAt));
        }
        return baseTransport.pushOperations(input);
      },
      pullOperations: (input) => baseTransport.pullOperations(input)
    };

    const resumedClient = new VfsBackgroundSyncClient(
      'user-1',
      'desktop',
      transport,
      {
        onGuardrailViolation: (violation) => {
          guardrailViolations.push({
            code: violation.code,
            stage: violation.stage,
            message: violation.message
          });
        }
      }
    );

    resumedClient.hydrateState(persisted);
    await resumedClient.flush();

    const firstPushedOccurredAtMs = pushedOccurredAtMs[0];
    const secondPushedOccurredAtMs = pushedOccurredAtMs[1];
    if (
      firstPushedOccurredAtMs === undefined ||
      secondPushedOccurredAtMs === undefined
    ) {
      throw new Error(`expected pushed timestamps for cycle ${index + 1}`);
    }

    const resumedState = resumedClient.exportState();
    const replayCursorAfterFlush = resumedState.replaySnapshot.cursor;
    replayAlignedAfterFlush.push(
      replayCursorAfterFlush !== null &&
        compareVfsSyncCursorOrder(
          resumedState.reconcileState?.cursor ?? replayCursor,
          replayCursorAfterFlush
        ) === 0
    );

    const cycleCursor = resumedClient.snapshot().cursor;
    if (!cycleCursor) {
      throw new Error(`expected cycle cursor for cycle ${index + 1}`);
    }

    cyclePushWriteIds.push([...pushedWriteIds]);
    cycleMetrics.push({
      cycleStartWriteId,
      pushedWriteIds: [...pushedWriteIds],
      nextLocalWriteId: resumedClient.snapshot().nextLocalWriteId,
      desktopLastReconciledWriteId:
        resumedClient.snapshot().lastReconciledWriteIds.desktop ?? 0,
      firstPushedOccurredAtMs,
      secondPushedOccurredAtMs,
      persistedCursorMs: Date.parse(replayCursor.changedAt)
    });
    cycleCursors.push({
      changedAt: cycleCursor.changedAt,
      changeId: cycleCursor.changeId
    });

    activeClient = resumedClient;
  }

  return {
    cyclePushWriteIds,
    cycleMetrics,
    cycleCursors,
    replayAlignedAfterFlush,
    guardrailViolations
  };
}
