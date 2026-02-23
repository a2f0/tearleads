import {
  InMemoryVfsCrdtFeedReplayStore,
  InMemoryVfsCrdtStateStore,
  type VfsCrdtOperation,
  type VfsCrdtSnapshot,
  type VfsCrdtSyncItem
} from '../index.js';

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function parseIsoMs(value: string): number {
  return Date.parse(value);
}

function compareFeedItems(
  left: VfsCrdtSyncItem,
  right: VfsCrdtSyncItem
): number {
  const leftMs = parseIsoMs(left.occurredAt);
  const rightMs = parseIsoMs(right.occurredAt);

  if (leftMs < rightMs) {
    return -1;
  }

  if (leftMs > rightMs) {
    return 1;
  }

  return left.opId.localeCompare(right.opId);
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

export function activeParentsForChild(
  snapshot: VfsCrdtSnapshot,
  childId: string
): string[] {
  return snapshot.links
    .filter((entry) => entry.childId === childId)
    .map((entry) => entry.parentId)
    .sort((left, right) => left.localeCompare(right));
}

export function activeChildrenForParent(
  snapshot: VfsCrdtSnapshot,
  parentId: string
): string[] {
  return snapshot.links
    .filter((entry) => entry.parentId === parentId)
    .map((entry) => entry.childId)
    .sort((left, right) => left.localeCompare(right));
}

export class InMemoryCrdtServerHarness {
  private readonly store = new InMemoryVfsCrdtStateStore();
  private readonly feedLog: VfsCrdtSyncItem[] = [];

  async applyConcurrent(
    writes: Array<{ delayMs: number; operation: VfsCrdtOperation }>
  ): Promise<void> {
    await Promise.all(
      writes.map(async ({ delayMs, operation }) => {
        await wait(delayMs);

        const result = this.store.apply(operation);
        if (result.status === 'applied') {
          this.feedLog.push(toSyncItem(operation));
        }
      })
    );

    this.feedLog.sort(compareFeedItems);
  }

  snapshot(): VfsCrdtSnapshot {
    return this.store.snapshot();
  }

  feed(): VfsCrdtSyncItem[] {
    return this.feedLog.slice();
  }
}

export class InMemoryReplicaHarness {
  private readonly store = new InMemoryVfsCrdtFeedReplayStore();

  async syncWithPageSize(
    feedItems: VfsCrdtSyncItem[],
    pageSize: number,
    delayMs: number
  ): Promise<void> {
    for (let index = 0; index < feedItems.length; index += pageSize) {
      const page = feedItems.slice(index, index + pageSize);
      await wait(delayMs);
      this.store.applyPage(page);
    }
  }

  applyPage(page: VfsCrdtSyncItem[]): void {
    this.store.applyPage(page);
  }

  snapshot() {
    return this.store.snapshot();
  }
}
