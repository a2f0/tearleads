import type { VfsCrdtSyncItem } from '@tearleads/shared';
import type { VfsSyncCursor } from './sync-cursor.js';
import { compareVfsSyncCursorOrder } from './sync-reconcile.js';

const DEFAULT_CONTAINER_CLOCK_LIMIT = 100;
const MAX_CONTAINER_CLOCK_LIMIT = 500;

function normalizeRequiredString(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function parseCursorFromItem(item: VfsCrdtSyncItem): VfsSyncCursor | null {
  const changeId = normalizeRequiredString(item.opId);
  if (!changeId) {
    return null;
  }

  const occurredAtMs = Date.parse(item.occurredAt);
  if (!Number.isFinite(occurredAtMs)) {
    return null;
  }

  return {
    changedAt: new Date(occurredAtMs).toISOString(),
    changeId
  };
}

function resolveContainerId(item: VfsCrdtSyncItem): string | null {
  if (item.opType === 'link_add' || item.opType === 'link_remove') {
    return normalizeRequiredString(item.parentId);
  }

  return normalizeRequiredString(item.itemId);
}

function compareEntries(
  left: VfsContainerClockEntry,
  right: VfsContainerClockEntry
): number {
  const cursorComparison = compareVfsSyncCursorOrder(
    {
      changedAt: left.changedAt,
      changeId: left.changeId
    },
    {
      changedAt: right.changedAt,
      changeId: right.changeId
    }
  );
  if (cursorComparison !== 0) {
    return cursorComparison;
  }

  return left.containerId.localeCompare(right.containerId);
}

function parseLimit(value: number | undefined): number {
  if (value === undefined) {
    return DEFAULT_CONTAINER_CLOCK_LIMIT;
  }

  if (!Number.isInteger(value)) {
    throw new Error(
      `limit must be an integer between 1 and ${MAX_CONTAINER_CLOCK_LIMIT}`
    );
  }

  if (value < 1 || value > MAX_CONTAINER_CLOCK_LIMIT) {
    throw new Error(
      `limit must be an integer between 1 and ${MAX_CONTAINER_CLOCK_LIMIT}`
    );
  }

  return value;
}

export interface VfsContainerClockEntry {
  containerId: string;
  changedAt: string;
  changeId: string;
}

export interface ListVfsContainerClockChangesResult {
  items: VfsContainerClockEntry[];
  hasMore: boolean;
  nextCursor: VfsSyncCursor | null;
}

export class InMemoryVfsContainerClockStore {
  private readonly clocksByContainerId: Map<string, VfsContainerClockEntry> =
    new Map();

  applyFeedItems(items: VfsCrdtSyncItem[]): void {
    for (let index = 0; index < items.length; index++) {
      const item = items[index];
      if (!item) {
        continue;
      }

      const cursor = parseCursorFromItem(item);
      if (!cursor) {
        throw new Error(`CRDT feed item ${index} has invalid cursor fields`);
      }

      const containerId = resolveContainerId(item);
      if (!containerId) {
        throw new Error(`CRDT feed item ${index} has invalid container fields`);
      }

      const existingEntry = this.clocksByContainerId.get(containerId);
      if (
        existingEntry &&
        compareVfsSyncCursorOrder(
          cursor,
          {
            changedAt: existingEntry.changedAt,
            changeId: existingEntry.changeId
          }
        ) <= 0
      ) {
        continue;
      }

      this.clocksByContainerId.set(containerId, {
        containerId,
        changedAt: cursor.changedAt,
        changeId: cursor.changeId
      });
    }
  }

  snapshot(): VfsContainerClockEntry[] {
    const entries = Array.from(this.clocksByContainerId.values());
    entries.sort(compareEntries);
    return entries;
  }

  listChangedSince(
    cursor: VfsSyncCursor | null,
    limit?: number
  ): ListVfsContainerClockChangesResult {
    const parsedLimit = parseLimit(limit);
    const allEntries = this.snapshot();

    const filteredEntries = allEntries.filter((entry) => {
      if (!cursor) {
        return true;
      }

      return (
        compareVfsSyncCursorOrder(
          {
            changedAt: entry.changedAt,
            changeId: entry.changeId
          },
          cursor
        ) > 0
      );
    });

    const items = filteredEntries.slice(0, parsedLimit);
    const hasMore = filteredEntries.length > items.length;
    const lastEntry = items.length > 0 ? items[items.length - 1] : null;

    return {
      items,
      hasMore,
      nextCursor: lastEntry
        ? {
            changedAt: lastEntry.changedAt,
            changeId: lastEntry.changeId
          }
        : null
    };
  }
}
