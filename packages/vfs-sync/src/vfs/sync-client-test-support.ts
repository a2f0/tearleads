import type { VfsCrdtSyncItem } from '@tearleads/shared';
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

export * from './sync-client-test-support-observers.js';
