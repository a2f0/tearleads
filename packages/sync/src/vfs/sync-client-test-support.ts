import type { VfsCrdtSyncItem } from '@tearleads/shared';
import { expect } from 'vitest';
import {
  VfsBackgroundSyncClient,
  VfsCrdtSyncPushRejectedError,
  type VfsCrdtSyncTransport
} from './sync-client.js';
import {
  InMemoryVfsCrdtSyncServer,
  InMemoryVfsCrdtSyncTransport
} from './sync-client-harness.js';
import { compareVfsSyncCursorOrder } from './sync-reconcile.js';

export {
  VfsBackgroundSyncClient,
  VfsCrdtSyncPushRejectedError,
  InMemoryVfsCrdtSyncServer,
  InMemoryVfsCrdtSyncTransport,
  compareVfsSyncCursorOrder
};
export type { VfsCrdtSyncItem, VfsCrdtSyncTransport };
export function wait(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

export async function waitFor(
  predicate: () => boolean,
  timeoutMs: number
): Promise<void> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (predicate()) {
      return;
    }

    await wait(5);
  }

  throw new Error('Timed out waiting for condition');
}

export function createDeterministicRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

export function nextInt(
  random: () => number,
  minInclusive: number,
  maxInclusive: number
): number {
  const span = maxInclusive - minInclusive + 1;
  return minInclusive + Math.floor(random() * span);
}

export function pickOne<T>(values: readonly T[], random: () => number): T {
  const index = nextInt(random, 0, values.length - 1);
  const value = values[index];
  if (value === undefined) {
    throw new Error('cannot pick from an empty list');
  }

  return value;
}

export function pickDifferent<T>(
  values: readonly T[],
  excluded: T,
  random: () => number
): T {
  if (values.length < 2) {
    throw new Error('need at least two values to pick a different entry');
  }

  let candidate = pickOne(values, random);
  while (candidate === excluded) {
    candidate = pickOne(values, random);
  }

  return candidate;
}

export function createSeededIsoTimestampFactory(input: {
  baseIso: string;
  seed: number;
  seedStrideMs?: number;
}): (offsetSeconds: number) => string {
  const baseMs =
    Date.parse(input.baseIso) + input.seed * (input.seedStrideMs ?? 10_000);
  return (offsetSeconds) =>
    new Date(baseMs + offsetSeconds * 1_000).toISOString();
}

export function createDeterministicJitterTransport(input: {
  server: InMemoryVfsCrdtSyncServer;
  random: () => number;
  maxDelayMs: number;
  canonicalClock: {
    currentMs: number;
  };
}): VfsCrdtSyncTransport {
  const nextDelayMs = (): number =>
    nextInt(input.random, 0, Math.max(0, input.maxDelayMs));

  return {
    pushOperations: async (pushInput) => {
      /**
       * Guardrail harness behavior: cursor pagination requires feed order to be
       * append-only relative to observed cursors. Normalize pushed timestamps so
       * canonical feed ordering tracks server apply order under random delays.
       */
      const normalizedOperations = pushInput.operations.map((operation) => {
        const parsedOccurredAtMs = Date.parse(operation.occurredAt);
        const baseOccurredAtMs = Number.isFinite(parsedOccurredAtMs)
          ? parsedOccurredAtMs
          : input.canonicalClock.currentMs;
        input.canonicalClock.currentMs = Math.max(
          input.canonicalClock.currentMs + 1,
          baseOccurredAtMs
        );
        return {
          ...operation,
          occurredAt: new Date(input.canonicalClock.currentMs).toISOString()
        };
      });

      await wait(nextDelayMs());
      return input.server.pushOperations({
        operations: normalizedOperations
      });
    },
    pullOperations: async (pullInput) => {
      await wait(nextDelayMs());
      return input.server.pullOperations({
        cursor: pullInput.cursor,
        limit: pullInput.limit
      });
    },
    reconcileState: async (reconcileInput) => {
      /**
       * Guardrail harness behavior: reconcile acknowledgements are modeled as an
       * authoritative replica-clock merge from server state while preserving the
       * client's cursor. This exercises the client reconcile lifecycle in tests
       * without requiring a separate server-side cursor table in-memory.
       */
      await wait(nextDelayMs());
      const snapshot = input.server.snapshot();
      return {
        cursor: reconcileInput.cursor,
        lastReconciledWriteIds: snapshot.lastReconciledWriteIds
      };
    }
  };
}

export function buildAclAddSyncItem(params: {
  opId: string;
  occurredAt: string;
  itemId?: string;
}): VfsCrdtSyncItem {
  return {
    opId: params.opId,
    itemId: params.itemId ?? 'item-1',
    opType: 'acl_add',
    principalType: 'group',
    principalId: 'group-1',
    accessLevel: 'read',
    parentId: null,
    childId: null,
    actorId: null,
    sourceTable: 'test',
    sourceId: params.opId,
    occurredAt: params.occurredAt
  };
}

export interface ContainerClockCursor {
  containerId: string;
  changedAt: string;
  changeId: string;
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

export function toStageCodeSignatures(
  events: Array<{ stage: string; code: string }>
): string[] {
  return events.map((event) => `${event.stage}:${event.code}`);
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

export type ReconcileState = NonNullable<
  VfsCrdtSyncTransport['reconcileState']
>;
export type ReconcileStateInput = Parameters<ReconcileState>[0];
export type ReconcileStateOutput = Awaited<ReturnType<ReconcileState>>;
export type PullOperationsInput = Parameters<
  VfsCrdtSyncTransport['pullOperations']
>[0];
export type PullOperationsOutput = Awaited<
  ReturnType<VfsCrdtSyncTransport['pullOperations']>
>;

export function createPhasePullRecordingTransport(input: {
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

export type GuardrailViolationSnapshot = {
  code: string;
  stage: string;
  message: string;
  details?: Record<string, string | number | boolean | null>;
};

export function expectLastWriteIdRegressionViolation(input: {
  violations: GuardrailViolationSnapshot[];
  stage: 'pull' | 'reconcile';
  replicaId: string;
  previousWriteId: number;
  incomingWriteId: number;
}): void {
  const message =
    input.stage === 'pull'
      ? 'pull response regressed replica write-id state'
      : 'reconcile acknowledgement regressed replica write-id state';

  expect(input.violations).toContainEqual({
    code: 'lastWriteIdRegression',
    stage: input.stage,
    message,
    details: {
      replicaId: input.replicaId,
      previousWriteId: input.previousWriteId,
      incomingWriteId: input.incomingWriteId
    }
  });
}

export function createGuardrailViolationCollector(): {
  violations: GuardrailViolationSnapshot[];
  onGuardrailViolation: (violation: GuardrailViolationSnapshot) => void;
} {
  const violations: GuardrailViolationSnapshot[] = [];
  return {
    violations,
    onGuardrailViolation: (violation) => {
      violations.push({
        code: violation.code,
        stage: violation.stage,
        message: violation.message,
        details: violation.details ? { ...violation.details } : undefined
      });
    }
  };
}
