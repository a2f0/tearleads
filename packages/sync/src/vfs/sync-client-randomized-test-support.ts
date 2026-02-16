import type { VfsCrdtSyncItem } from '@tearleads/shared';
import { expect } from 'vitest';
import type {
  VfsBackgroundSyncClient,
  VfsCrdtSyncTransport
} from './sync-client.js';
import { compareVfsSyncCursorOrder } from './sync-reconcile.js';

export function createDeterministicRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

function nextInt(
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

function pickDifferent<T>(
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

export function pickTwoDistinct<T>(
  values: readonly T[],
  random: () => number
): [T, T] {
  const first = pickOne(values, random);
  return [first, pickDifferent(values, first, random)];
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

type ReconcileState = NonNullable<VfsCrdtSyncTransport['reconcileState']>;
type ReconcileStateInput = Parameters<ReconcileState>[0];
type ReconcileStateOutput = Awaited<ReturnType<ReconcileState>>;
type PullOperationsInput = Parameters<
  VfsCrdtSyncTransport['pullOperations']
>[0];
type PullOperationsOutput = Awaited<
  ReturnType<VfsCrdtSyncTransport['pullOperations']>
>;

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

export type GuardrailViolationSnapshot = {
  code: string;
  stage: string;
  message: string;
  details?: Record<string, string | number | boolean | null>;
};

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

export function toStageCodeSignatures(
  events: Array<{ stage: string; code: string }>
): string[] {
  return events.map((event) => `${event.stage}:${event.code}`);
}

export function toStageCodeReplicaSignatures(
  events: Array<{
    stage: string;
    code: string;
    details?: Record<string, string | number | boolean | null>;
  }>
): string[] {
  return events.map((event) => {
    const replicaId = event.details?.['replicaId'];
    return `${event.stage}:${event.code}:${typeof replicaId === 'string' ? replicaId : 'none'}`;
  });
}
