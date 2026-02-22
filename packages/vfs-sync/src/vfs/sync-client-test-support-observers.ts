import type { VfsCrdtSyncItem } from '@tearleads/shared';
import { expect } from 'vitest';
import type {
  VfsBackgroundSyncClient,
  VfsBackgroundSyncClientPersistedState,
  VfsCrdtSyncTransport
} from './sync-client.js';
import { compareVfsSyncCursorOrder } from './sync-reconcile.js';

interface ContainerClockCursor {
  containerId: string;
  changedAt: string;
  changeId: string;
}

export function captureExportedSyncClientState(
  client: VfsBackgroundSyncClient
): VfsBackgroundSyncClientPersistedState {
  return client.exportState();
}

export function expectExportedSyncClientStateUnchanged(input: {
  client: VfsBackgroundSyncClient;
  before: VfsBackgroundSyncClientPersistedState;
}): void {
  expect(input.client.exportState()).toEqual(input.before);
}

export function toContainerClockCursorMap(
  clocks: ContainerClockCursor[]
): Map<string, { changedAt: string; changeId: string }> {
  const result = new Map<string, { changedAt: string; changeId: string }>();
  for (const clock of clocks) {
    result.set(clock.containerId, {
      changedAt: clock.changedAt,
      changeId: clock.changeId
    });
  }
  return result;
}

export function expectContainerClocksMonotonic(
  before: ContainerClockCursor[],
  after: ContainerClockCursor[]
): void {
  const beforeMap = toContainerClockCursorMap(before);
  const afterMap = toContainerClockCursorMap(after);

  for (const [containerId, beforeCursor] of beforeMap.entries()) {
    const afterCursor = afterMap.get(containerId);
    expect(afterCursor).toBeDefined();
    if (!afterCursor) {
      continue;
    }

    expect(
      compareVfsSyncCursorOrder(afterCursor, beforeCursor)
    ).toBeGreaterThanOrEqual(0);
  }
}

export interface ObservedPullPage {
  requestCursor: { changedAt: string; changeId: string } | null;
  items: VfsCrdtSyncItem[];
  hasMore: boolean;
  nextCursor: { changedAt: string; changeId: string } | null;
}

export type ObservedPullPhase = 'seed' | 'resumed';

export interface ObservedPhasePullPage extends ObservedPullPage {
  phase: ObservedPullPhase;
  lastReconciledWriteIds?: Record<string, number>;
}

export interface ObservedPhaseReconcileSnapshot {
  phase: ObservedPullPhase;
  cursor: { changedAt: string; changeId: string };
  lastReconciledWriteIds: Record<string, number>;
}

type ReconcileState = NonNullable<VfsCrdtSyncTransport['reconcileState']>;
type ReconcileStateInput = Parameters<ReconcileState>[0];
type ReconcileStateOutput = Awaited<ReturnType<ReconcileState>>;
type PullOperationsInput = Parameters<
  VfsCrdtSyncTransport['pullOperations']
>[0];
type PullOperationsOutput = Awaited<
  ReturnType<VfsCrdtSyncTransport['pullOperations']>
>;

function createPhasePullRecordingTransport(input: {
  phase: ObservedPullPhase;
  baseTransport: VfsCrdtSyncTransport;
  observedPulls: ObservedPhasePullPage[];
  includeLastReconciledWriteIds?: boolean;
  reconcileState?: (input: {
    phase: ObservedPullPhase;
    reconcileInput: ReconcileStateInput;
    baseTransport: VfsCrdtSyncTransport;
  }) => Promise<ReconcileStateOutput>;
}): VfsCrdtSyncTransport {
  const baseReconcileState = input.baseTransport.reconcileState;
  const reconcileState = input.reconcileState
    ? (reconcileInput: ReconcileStateInput) =>
        input.reconcileState({
          phase: input.phase,
          reconcileInput,
          baseTransport: input.baseTransport
        })
    : baseReconcileState
      ? (reconcileInput: ReconcileStateInput) =>
          baseReconcileState(reconcileInput)
      : undefined;

  return {
    pushOperations: (pushInput) =>
      input.baseTransport.pushOperations(pushInput),
    pullOperations: async (pullInput) => {
      const response = await input.baseTransport.pullOperations(pullInput);
      const observedPull: ObservedPhasePullPage = {
        phase: input.phase,
        requestCursor: pullInput.cursor ? { ...pullInput.cursor } : null,
        items: response.items.map((item) => ({ ...item })),
        hasMore: response.hasMore,
        nextCursor: response.nextCursor ? { ...response.nextCursor } : null
      };
      if (input.includeLastReconciledWriteIds) {
        observedPull.lastReconciledWriteIds = {
          ...response.lastReconciledWriteIds
        };
      }
      input.observedPulls.push(observedPull);
      return response;
    },
    reconcileState
  };
}

export function createPhasePullRecordingTransportFactory(input: {
  baseTransport: VfsCrdtSyncTransport;
  observedPulls: ObservedPhasePullPage[];
  includeLastReconciledWriteIds?: boolean;
  reconcileState?: (input: {
    phase: ObservedPullPhase;
    reconcileInput: ReconcileStateInput;
    baseTransport: VfsCrdtSyncTransport;
  }) => Promise<ReconcileStateOutput>;
}): (phase: ObservedPullPhase) => VfsCrdtSyncTransport {
  return (phase: ObservedPullPhase) =>
    createPhasePullRecordingTransport({
      phase,
      baseTransport: input.baseTransport,
      observedPulls: input.observedPulls,
      includeLastReconciledWriteIds: input.includeLastReconciledWriteIds,
      reconcileState: input.reconcileState
    });
}

export function filterObservedPullsByPhase(input: {
  observedPulls: ObservedPhasePullPage[];
  phase: ObservedPullPhase;
}): ObservedPhasePullPage[] {
  return input.observedPulls.filter((pull) => pull.phase === input.phase);
}

export function createPhaseReconcileRecordingHandler(input: {
  observedInputs?: ObservedPhaseReconcileSnapshot[];
  observedResponses?: ObservedPhaseReconcileSnapshot[];
  resolve: (input: {
    phase: ObservedPullPhase;
    reconcileInput: ReconcileStateInput;
    callCount: number;
    baseTransport: VfsCrdtSyncTransport;
  }) => Promise<ReconcileStateOutput> | ReconcileStateOutput;
}): (input: {
  phase: ObservedPullPhase;
  reconcileInput: ReconcileStateInput;
  baseTransport: VfsCrdtSyncTransport;
}) => Promise<ReconcileStateOutput> {
  let callCount = 0;
  return async (handlerInput) => {
    callCount += 1;
    input.observedInputs?.push({
      phase: handlerInput.phase,
      cursor: { ...handlerInput.reconcileInput.cursor },
      lastReconciledWriteIds: {
        ...handlerInput.reconcileInput.lastReconciledWriteIds
      }
    });

    const response = await input.resolve({
      phase: handlerInput.phase,
      reconcileInput: handlerInput.reconcileInput,
      callCount,
      baseTransport: handlerInput.baseTransport
    });

    input.observedResponses?.push({
      phase: handlerInput.phase,
      cursor: { ...response.cursor },
      lastReconciledWriteIds: { ...response.lastReconciledWriteIds }
    });

    return response;
  };
}

export function createCallCountedReconcileResolver(input: {
  resolve: (input: {
    reconcileInput: ReconcileStateInput;
    callCount: number;
  }) => Promise<ReconcileStateOutput> | ReconcileStateOutput;
}): (reconcileInput: ReconcileStateInput) => Promise<ReconcileStateOutput> {
  let callCount = 0;
  return async (reconcileInput) => {
    callCount += 1;
    return input.resolve({
      reconcileInput,
      callCount
    });
  };
}

export function createCallCountedPullResolver(input: {
  resolve: (input: {
    pullInput: PullOperationsInput;
    callCount: number;
  }) => Promise<PullOperationsOutput> | PullOperationsOutput;
}): (pullInput: PullOperationsInput) => Promise<PullOperationsOutput> {
  let callCount = 0;
  return async (pullInput) => {
    callCount += 1;
    return input.resolve({
      pullInput,
      callCount
    });
  };
}

export function createPullRecordingTransport(input: {
  baseTransport: VfsCrdtSyncTransport;
  observedPulls: ObservedPullPage[];
}): VfsCrdtSyncTransport {
  return {
    pushOperations: (pushInput) =>
      input.baseTransport.pushOperations(pushInput),
    pullOperations: async (pullInput) => {
      const response = await input.baseTransport.pullOperations(pullInput);
      input.observedPulls.push({
        requestCursor: pullInput.cursor ? { ...pullInput.cursor } : null,
        items: response.items.map((item) => ({ ...item })),
        hasMore: response.hasMore,
        nextCursor: response.nextCursor ? { ...response.nextCursor } : null
      });
      return response;
    },
    reconcileState: input.baseTransport.reconcileState
      ? (reconcileInput) => input.baseTransport.reconcileState(reconcileInput)
      : undefined
  };
}

export function readForwardContainerSignatures(input: {
  client: VfsBackgroundSyncClient;
  seedCursor: {
    changedAt: string;
    changeId: string;
  };
  pageLimit: number;
}): string[] {
  const signatures: string[] = [];
  let cursor = input.seedCursor;

  while (true) {
    const page = input.client.listChangedContainers(cursor, input.pageLimit);
    for (const item of page.items) {
      const itemCursor = {
        changedAt: item.changedAt,
        changeId: item.changeId
      };
      expect(compareVfsSyncCursorOrder(itemCursor, input.seedCursor)).toBe(1);
      expect(compareVfsSyncCursorOrder(itemCursor, cursor)).toBe(1);
      signatures.push(`${item.containerId}|${item.changeId}`);
    }

    if (!page.hasMore) {
      break;
    }

    if (!page.nextCursor) {
      throw new Error('expected next container cursor when hasMore is true');
    }
    expect(compareVfsSyncCursorOrder(page.nextCursor, cursor)).toBe(1);
    cursor = page.nextCursor;
  }

  return signatures;
}

export function readSeedContainerCursorOrThrow(input: {
  client: VfsBackgroundSyncClient;
  pageLimit: number;
  errorMessage: string;
}): { changedAt: string; changeId: string } {
  const seedCursor = input.client.listChangedContainers(
    null,
    input.pageLimit
  ).nextCursor;
  if (!seedCursor) {
    throw new Error(input.errorMessage);
  }

  return seedCursor;
}

export function readReplaySnapshotCursorOrThrow(input: {
  state: {
    replaySnapshot: {
      cursor: {
        changedAt: string;
        changeId: string;
      } | null;
    };
  };
  errorMessage: string;
}): { changedAt: string; changeId: string } {
  const seedReplayCursor = input.state.replaySnapshot.cursor;
  if (!seedReplayCursor) {
    throw new Error(input.errorMessage);
  }

  return seedReplayCursor;
}
// Re-export guardrail test helpers from dedicated module
export {
  createGuardrailViolationCollector,
  expectExactGuardrailSignatures,
  expectGuardrailSignature,
  expectHydrateGuardrailViolation,
  expectLastWriteIdRegressionViolation,
  expectPullCursorRegressionViolation,
  expectPullDuplicateOpReplayViolation,
  expectPullPageInvariantViolation,
  expectReconcileCursorRegressionViolation,
  expectStaleWriteRecoveryExhaustedViolation,
  toStageCodeSignatures
} from './sync-client-test-support-guardrails.js';
