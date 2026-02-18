import type {
  ObservedPhasePullPage,
  VfsCrdtSyncTransport
} from './sync-client-test-support.js';
import {
  createGuardrailViolationCollector,
  createPhasePullRecordingTransportFactory,
  createPhaseReconcileRecordingHandler,
  filterObservedPullsByPhase,
  InMemoryVfsCrdtSyncServer,
  InMemoryVfsCrdtSyncTransport,
  readReplaySnapshotCursorOrThrow,
  VfsBackgroundSyncClient
} from './sync-client-test-support.js';

interface ReconcileRestartSnapshot {
  lastReconciledWriteIds: Record<string, number>;
  cursor: {
    changedAt: string;
    changeId: string;
  } | null;
}

export interface ReconcileRestartRegressionResult {
  syncError: string | null;
  guardrailViolations: ReturnType<
    typeof createGuardrailViolationCollector
  >['violations'];
  resumedPulls: ObservedPhasePullPage[];
  seedReplayCursor: {
    changedAt: string;
    changeId: string;
  };
  finalSnapshot: ReconcileRestartSnapshot;
  hasRecoveredAcl: boolean;
}

export interface ReconcileRestartRecoveryResult {
  firstSyncError: string | null;
  guardrailViolations: ReturnType<
    typeof createGuardrailViolationCollector
  >['violations'];
  resumedPulls: ObservedPhasePullPage[];
  seedReplayCursor: {
    changedAt: string;
    changeId: string;
  };
  postFailureSnapshot: ReconcileRestartSnapshot;
  recoveryResult: {
    pulledOperations: number;
    pullPages: number;
  };
  guardrailCountBeforeRecovery: number;
  guardrailCountAfterRecovery: number;
  postRecoverySnapshot: ReconcileRestartSnapshot;
}

function buildObservedTransport(input: {
  baseTransport: InMemoryVfsCrdtSyncTransport;
  observedPulls: ObservedPhasePullPage[];
  reconcileState: VfsCrdtSyncTransport['reconcileState'];
}) {
  return createPhasePullRecordingTransportFactory({
    baseTransport: input.baseTransport,
    observedPulls: input.observedPulls,
    reconcileState: input.reconcileState
  });
}

function snapshotShape(
  client: VfsBackgroundSyncClient
): ReconcileRestartSnapshot {
  const snapshot = client.snapshot();
  return {
    lastReconciledWriteIds: snapshot.lastReconciledWriteIds,
    cursor: snapshot.cursor
  };
}

export async function runReconcileRestartRegressionScenario(): Promise<ReconcileRestartRegressionResult> {
  const server = new InMemoryVfsCrdtSyncServer();
  await server.pushOperations({
    operations: [
      {
        opId: 'remote-1',
        opType: 'acl_add',
        itemId: 'item-reconcile-regress-a',
        replicaId: 'remote',
        writeId: 1,
        occurredAt: '2026-02-14T12:23:00.000Z',
        principalType: 'group',
        principalId: 'group-1',
        accessLevel: 'read'
      },
      {
        opId: 'remote-2',
        opType: 'acl_add',
        itemId: 'item-reconcile-regress-b',
        replicaId: 'remote',
        writeId: 2,
        occurredAt: '2026-02-14T12:23:01.000Z',
        principalType: 'group',
        principalId: 'group-2',
        accessLevel: 'write'
      }
    ]
  });

  const baseTransport = new InMemoryVfsCrdtSyncTransport(server);
  const guardrailCollector = createGuardrailViolationCollector();
  const guardrailViolations = guardrailCollector.violations;
  const observedPulls: ObservedPhasePullPage[] = [];

  const reconcileState = createPhaseReconcileRecordingHandler({
    resolve: ({ reconcileInput, callCount }) => {
      if (callCount === 1) {
        return {
          cursor: { ...reconcileInput.cursor },
          lastReconciledWriteIds: {
            ...reconcileInput.lastReconciledWriteIds,
            desktop: 3,
            mobile: 5
          }
        };
      }

      return {
        cursor: { ...reconcileInput.cursor },
        lastReconciledWriteIds: {
          ...reconcileInput.lastReconciledWriteIds,
          desktop: 4,
          mobile: 4
        }
      };
    }
  });

  const makeObservedTransport = buildObservedTransport({
    baseTransport,
    observedPulls,
    reconcileState
  });

  const seedClient = new VfsBackgroundSyncClient(
    'user-1',
    'desktop',
    makeObservedTransport('seed'),
    {
      pullLimit: 1,
      onGuardrailViolation: guardrailCollector.onGuardrailViolation
    }
  );
  await seedClient.sync();

  const persistedSeedState = seedClient.exportState();
  const seedReplayCursor = readReplaySnapshotCursorOrThrow({
    state: persistedSeedState,
    errorMessage: 'expected seed replay cursor before reconcile regression'
  });

  await server.pushOperations({
    operations: [
      {
        opId: 'remote-3',
        opType: 'link_add',
        itemId: 'item-reconcile-regress-c',
        replicaId: 'remote',
        writeId: 3,
        occurredAt: '2026-02-14T12:23:02.000Z',
        parentId: 'root',
        childId: 'item-reconcile-regress-c'
      },
      {
        opId: 'remote-4',
        opType: 'acl_add',
        itemId: 'item-reconcile-regress-c',
        replicaId: 'remote',
        writeId: 4,
        occurredAt: '2026-02-14T12:23:03.000Z',
        principalType: 'organization',
        principalId: 'org-1',
        accessLevel: 'admin'
      }
    ]
  });

  const resumedClient = new VfsBackgroundSyncClient(
    'user-1',
    'desktop',
    makeObservedTransport('resumed'),
    {
      pullLimit: 1,
      onGuardrailViolation: guardrailCollector.onGuardrailViolation
    }
  );
  resumedClient.hydrateState(persistedSeedState);

  let syncError: string | null = null;
  try {
    await resumedClient.sync();
  } catch (error) {
    syncError = error instanceof Error ? error.message : String(error);
  }

  return {
    syncError,
    guardrailViolations,
    resumedPulls: filterObservedPullsByPhase({
      observedPulls,
      phase: 'resumed'
    }),
    seedReplayCursor,
    finalSnapshot: snapshotShape(resumedClient),
    hasRecoveredAcl: resumedClient
      .snapshot()
      .acl.some(
        (entry) =>
          entry.itemId === 'item-reconcile-regress-c' &&
          entry.principalId === 'org-1'
      )
  };
}

export async function runReconcileRestartRecoveryScenario(): Promise<ReconcileRestartRecoveryResult> {
  const server = new InMemoryVfsCrdtSyncServer();
  await server.pushOperations({
    operations: [
      {
        opId: 'remote-1',
        opType: 'acl_add',
        itemId: 'item-reconcile-recovery-a',
        replicaId: 'remote',
        writeId: 1,
        occurredAt: '2026-02-14T12:24:00.000Z',
        principalType: 'group',
        principalId: 'group-1',
        accessLevel: 'read'
      },
      {
        opId: 'remote-2',
        opType: 'acl_add',
        itemId: 'item-reconcile-recovery-b',
        replicaId: 'remote',
        writeId: 2,
        occurredAt: '2026-02-14T12:24:01.000Z',
        principalType: 'group',
        principalId: 'group-2',
        accessLevel: 'write'
      }
    ]
  });

  const baseTransport = new InMemoryVfsCrdtSyncTransport(server);
  const guardrailCollector = createGuardrailViolationCollector();
  const guardrailViolations = guardrailCollector.violations;
  const observedPulls: ObservedPhasePullPage[] = [];

  const reconcileState = createPhaseReconcileRecordingHandler({
    resolve: ({ reconcileInput, callCount }) => {
      if (callCount === 1) {
        return {
          cursor: { ...reconcileInput.cursor },
          lastReconciledWriteIds: {
            ...reconcileInput.lastReconciledWriteIds,
            desktop: 3,
            mobile: 5
          }
        };
      }

      if (callCount === 2) {
        return {
          cursor: { ...reconcileInput.cursor },
          lastReconciledWriteIds: {
            ...reconcileInput.lastReconciledWriteIds,
            desktop: 4,
            mobile: 4
          }
        };
      }

      return {
        cursor: { ...reconcileInput.cursor },
        lastReconciledWriteIds: {
          ...reconcileInput.lastReconciledWriteIds,
          desktop: 4,
          mobile: 6
        }
      };
    }
  });

  const makeObservedTransport = buildObservedTransport({
    baseTransport,
    observedPulls,
    reconcileState
  });

  const seedClient = new VfsBackgroundSyncClient(
    'user-1',
    'desktop',
    makeObservedTransport('seed'),
    {
      pullLimit: 1,
      onGuardrailViolation: guardrailCollector.onGuardrailViolation
    }
  );
  await seedClient.sync();

  const persistedSeedState = seedClient.exportState();
  const seedReplayCursor = readReplaySnapshotCursorOrThrow({
    state: persistedSeedState,
    errorMessage: 'expected seed replay cursor before recovery test'
  });

  await server.pushOperations({
    operations: [
      {
        opId: 'remote-3',
        opType: 'link_add',
        itemId: 'item-reconcile-recovery-c',
        replicaId: 'remote',
        writeId: 3,
        occurredAt: '2026-02-14T12:24:02.000Z',
        parentId: 'root',
        childId: 'item-reconcile-recovery-c'
      },
      {
        opId: 'remote-4',
        opType: 'acl_add',
        itemId: 'item-reconcile-recovery-c',
        replicaId: 'remote',
        writeId: 4,
        occurredAt: '2026-02-14T12:24:03.000Z',
        principalType: 'organization',
        principalId: 'org-1',
        accessLevel: 'admin'
      }
    ]
  });

  const resumedClient = new VfsBackgroundSyncClient(
    'user-1',
    'desktop',
    makeObservedTransport('resumed'),
    {
      pullLimit: 1,
      onGuardrailViolation: guardrailCollector.onGuardrailViolation
    }
  );
  resumedClient.hydrateState(persistedSeedState);

  let firstSyncError: string | null = null;
  try {
    await resumedClient.sync();
  } catch (error) {
    firstSyncError = error instanceof Error ? error.message : String(error);
  }

  const postFailureSnapshot = snapshotShape(resumedClient);
  const guardrailCountBeforeRecovery = guardrailViolations.length;
  const recoveryResult = await resumedClient.sync();

  return {
    firstSyncError,
    guardrailViolations,
    resumedPulls: filterObservedPullsByPhase({
      observedPulls,
      phase: 'resumed'
    }),
    seedReplayCursor,
    postFailureSnapshot,
    recoveryResult,
    guardrailCountBeforeRecovery,
    guardrailCountAfterRecovery: guardrailViolations.length,
    postRecoverySnapshot: snapshotShape(resumedClient)
  };
}
