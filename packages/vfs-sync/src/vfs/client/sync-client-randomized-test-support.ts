import type { VfsCrdtSyncItem } from '@tearleads/shared';
import { expect } from 'vitest';
import type {
  VfsBackgroundSyncClient,
  VfsCrdtSyncTransport
} from './sync-client.js';
import { compareVfsSyncCursorOrder } from '../protocol/sync-reconcile.js';

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

function pickTwoDistinct<T>(
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

type MixedRecoveryParentCandidate = 'root' | 'archive' | 'workspace';
type MixedRecoveryPrincipalType = 'group' | 'organization';
type MixedRecoveryAccessLevel = 'read' | 'write' | 'admin';

interface SeededMixedRecoveryInputBundle {
  parentOne: MixedRecoveryParentCandidate;
  parentTwo: MixedRecoveryParentCandidate;
  principalType: MixedRecoveryPrincipalType;
  accessLevel: MixedRecoveryAccessLevel;
  at: (offsetSeconds: number) => string;
}

export function createSeededMixedRecoveryInputBundle(input: {
  seed: number;
  baseIso: string;
  seedStrideMs?: number;
  parentCandidates?: readonly MixedRecoveryParentCandidate[];
  principalTypes?: readonly MixedRecoveryPrincipalType[];
  accessLevels?: readonly MixedRecoveryAccessLevel[];
}): SeededMixedRecoveryInputBundle {
  const random = createDeterministicRandom(input.seed);
  const parentCandidates =
    input.parentCandidates ?? (['root', 'archive', 'workspace'] as const);
  const principalTypes =
    input.principalTypes ?? (['group', 'organization'] as const);
  const accessLevels =
    input.accessLevels ?? (['read', 'write', 'admin'] as const);

  const [parentOne, parentTwo] = pickTwoDistinct(parentCandidates, random);
  const principalType = pickOne(principalTypes, random);
  const accessLevel = pickOne(accessLevels, random);
  const at = createSeededIsoTimestampFactory({
    baseIso: input.baseIso,
    seed: input.seed,
    seedStrideMs: input.seedStrideMs
  });

  return {
    parentOne,
    parentTwo,
    principalType,
    accessLevel,
    at
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

function clonePullOperationsOutput(
  output: PullOperationsOutput
): PullOperationsOutput {
  return {
    items: output.items.map((item) => ({ ...item })),
    hasMore: output.hasMore,
    nextCursor: output.nextCursor ? { ...output.nextCursor } : null,
    lastReconciledWriteIds: { ...output.lastReconciledWriteIds }
  };
}

export function createCallCountedReconcileResolverFromWriteIds(input: {
  writeIds: readonly number[];
  replicaId?: string;
}): (reconcileInput: ReconcileStateInput) => Promise<ReconcileStateOutput> {
  if (input.writeIds.length === 0) {
    throw new Error('writeIds must include at least one value');
  }

  const replicaId = input.replicaId ?? 'mobile';
  return createCallCountedReconcileResolver({
    resolve: ({ reconcileInput, callCount }) => {
      const writeId =
        input.writeIds[Math.min(callCount - 1, input.writeIds.length - 1)];
      if (writeId === undefined) {
        throw new Error('missing reconcile write-id script entry');
      }

      return {
        cursor: { ...reconcileInput.cursor },
        lastReconciledWriteIds: {
          ...reconcileInput.lastReconciledWriteIds,
          [replicaId]: writeId
        }
      };
    }
  });
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

export function createCallCountedPullResolverFromPages(input: {
  pages: readonly PullOperationsOutput[];
}): (pullInput: PullOperationsInput) => Promise<PullOperationsOutput> {
  if (input.pages.length === 0) {
    throw new Error('pages must include at least one scripted pull response');
  }

  return createCallCountedPullResolver({
    resolve: ({ callCount }) => {
      const page = input.pages[Math.min(callCount - 1, input.pages.length - 1)];
      if (!page) {
        throw new Error('missing scripted pull response for call count');
      }

      return clonePullOperationsOutput(page);
    }
  });
}

const MIXED_RECOVERY_GUARDRAIL_SIGNATURES = [
  'pull:lastWriteIdRegression:desktop',
  'reconcile:lastWriteIdRegression:mobile'
] as const;

export function buildMixedRecoveryExpectedSignatures(input: {
  firstParentId: string;
  firstChangeId: string;
  middleContainerId: string;
  middleChangeId: string;
  secondParentId: string;
  secondChangeId: string;
  phantomContainerId: string;
  phantomChangeId: string;
}): {
  expectedPageSignatures: string[];
  expectedGuardrailSignatures: readonly string[];
  excludedPhantomSignature: string;
} {
  return {
    expectedPageSignatures: [
      `${input.firstParentId}|${input.firstChangeId}`,
      `${input.middleContainerId}|${input.middleChangeId}`,
      `${input.secondParentId}|${input.secondChangeId}`
    ],
    expectedGuardrailSignatures: MIXED_RECOVERY_GUARDRAIL_SIGNATURES,
    excludedPhantomSignature: `${input.phantomContainerId}|${input.phantomChangeId}`
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

type GuardrailViolationSnapshot = {
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
