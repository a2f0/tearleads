import type { VfsCrdtSyncItem } from '@tearleads/shared';
import {
  delayVfsCrdtSyncTransport,
  type InMemoryVfsCrdtSyncTransportDelayConfig,
  type VfsCrdtSyncPullResponse,
  type VfsCrdtSyncPushResponse,
  type VfsCrdtSyncTransport
} from './sync-client.js';
import {
  InMemoryVfsCrdtStateStore,
  type VfsCrdtOperation
} from './sync-crdt.js';
import { InMemoryVfsCrdtFeedReplayStore } from './sync-crdt-feed-replay.js';
import type { VfsSyncCursor } from './sync-cursor.js';
import { compareVfsSyncCursorOrder } from './sync-reconcile.js';

function parseOccurredAtMs(value: string): number {
  const parsedMs = Date.parse(value);
  if (!Number.isFinite(parsedMs)) {
    throw new Error(`invalid occurredAt: ${value}`);
  }

  return parsedMs;
}

function compareFeedItems(
  left: VfsCrdtSyncItem,
  right: VfsCrdtSyncItem
): number {
  const leftMs = parseOccurredAtMs(left.occurredAt);
  const rightMs = parseOccurredAtMs(right.occurredAt);

  if (leftMs < rightMs) {
    return -1;
  }
  if (leftMs > rightMs) {
    return 1;
  }

  return left.opId.localeCompare(right.opId);
}

function toCursor(item: VfsCrdtSyncItem): VfsSyncCursor {
  return {
    changedAt: new Date(parseOccurredAtMs(item.occurredAt)).toISOString(),
    changeId: item.opId
  };
}

function toSyncItem(operation: VfsCrdtOperation): VfsCrdtSyncItem {
  return {
    opId: operation.opId,
    itemId: operation.itemId,
    opType: operation.opType,
    principalType: operation.principalType ?? null,
    principalId: operation.principalId ?? null,
    accessLevel: operation.accessLevel ?? null,
    parentId: operation.parentId ?? null,
    childId: operation.childId ?? null,
    actorId: null,
    sourceTable: 'test',
    sourceId: operation.opId,
    occurredAt: operation.occurredAt
  };
}

export interface InMemoryVfsCrdtSyncServerSnapshot {
  feed: VfsCrdtSyncItem[];
  acl: Array<{
    itemId: string;
    principalType: 'user' | 'group' | 'organization';
    principalId: string;
    accessLevel: 'read' | 'write' | 'admin';
  }>;
  links: Array<{
    parentId: string;
    childId: string;
  }>;
  lastReconciledWriteIds: Record<string, number>;
}

export class InMemoryVfsCrdtSyncServer {
  private readonly stateStore = new InMemoryVfsCrdtStateStore();
  private readonly feed: VfsCrdtSyncItem[] = [];
  private readonly appliedOpIds: Set<string> = new Set();

  async pushOperations(input: {
    operations: VfsCrdtOperation[];
  }): Promise<VfsCrdtSyncPushResponse> {
    const results: VfsCrdtSyncPushResponse['results'] = [];

    for (const operation of input.operations) {
      if (this.appliedOpIds.has(operation.opId)) {
        results.push({
          opId: operation.opId,
          status: 'alreadyApplied'
        });
        continue;
      }

      const result = this.stateStore.apply(operation);
      if (result.status === 'applied') {
        this.feed.push(toSyncItem(operation));
        this.appliedOpIds.add(operation.opId);
      }

      results.push({
        opId: result.opId,
        status: result.status
      });
    }

    this.feed.sort(compareFeedItems);
    return { results };
  }

  async pullOperations(input: {
    cursor: VfsSyncCursor | null;
    limit: number;
  }): Promise<VfsCrdtSyncPullResponse> {
    const limit = input.limit;
    let startIndex = 0;
    if (input.cursor) {
      while (startIndex < this.feed.length) {
        const candidateItem = this.feed[startIndex];
        if (!candidateItem) {
          break;
        }

        const comparison = compareVfsSyncCursorOrder(
          toCursor(candidateItem),
          input.cursor
        );
        if (comparison > 0) {
          break;
        }

        startIndex += 1;
      }
    }

    const items = this.feed.slice(startIndex, startIndex + limit);
    const hasMore = startIndex + items.length < this.feed.length;
    const lastItem = items.length > 0 ? items[items.length - 1] : null;
    const nextCursor = lastItem ? toCursor(lastItem) : null;
    const snapshot = this.stateStore.snapshot();

    return {
      items,
      hasMore,
      nextCursor,
      lastReconciledWriteIds: snapshot.lastReconciledWriteIds
    };
  }

  snapshot(): InMemoryVfsCrdtSyncServerSnapshot {
    const snapshot = this.stateStore.snapshot();
    /**
     * Guardrail: protocol correctness is defined by canonical feed replay order
     * (`occurredAt`, then `opId`), not by the arrival order of concurrent push
     * RPCs. Recompute ACL/link projections from feed for deterministic checks.
     */
    const replayStore = new InMemoryVfsCrdtFeedReplayStore();
    replayStore.applyPage(this.feed);
    const replaySnapshot = replayStore.snapshot();
    return {
      feed: this.feed.slice(),
      acl: replaySnapshot.acl,
      links: replaySnapshot.links,
      lastReconciledWriteIds: snapshot.lastReconciledWriteIds
    };
  }
}

export class InMemoryVfsCrdtSyncTransport implements VfsCrdtSyncTransport {
  private readonly server: InMemoryVfsCrdtSyncServer;
  private readonly delays: InMemoryVfsCrdtSyncTransportDelayConfig;

  constructor(
    server: InMemoryVfsCrdtSyncServer,
    delays: InMemoryVfsCrdtSyncTransportDelayConfig = {}
  ) {
    this.server = server;
    this.delays = delays;
  }

  async pushOperations(input: {
    userId: string;
    clientId: string;
    operations: VfsCrdtOperation[];
  }): Promise<VfsCrdtSyncPushResponse> {
    await delayVfsCrdtSyncTransport(this.delays, 'push');
    return this.server.pushOperations({
      operations: input.operations
    });
  }

  async pullOperations(input: {
    userId: string;
    clientId: string;
    cursor: VfsSyncCursor | null;
    limit: number;
  }): Promise<VfsCrdtSyncPullResponse> {
    await delayVfsCrdtSyncTransport(this.delays, 'pull');
    return this.server.pullOperations({
      cursor: input.cursor,
      limit: input.limit
    });
  }
}
