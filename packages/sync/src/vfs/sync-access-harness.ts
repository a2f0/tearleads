import type { VfsAclAccessLevel, VfsAclPrincipalType } from '@tearleads/shared';
import {
  buildVfsAclKeyView,
  type VfsAclSnapshotEntry
} from './acl-key-view.js';
import type { VfsCrdtSyncItem } from './sync-crdt-feed.js';
import {
  InMemoryVfsCrdtFeedReplayStore,
  type VfsCrdtFeedReplaySnapshot
} from './sync-crdt-feed-replay.js';

export interface EffectiveVfsAclKeyViewEntry {
  itemId: string;
  principalType: VfsAclPrincipalType;
  principalId: string;
  accessLevel: VfsAclAccessLevel;
  wrappedSessionKey: string | null;
  wrappedHierarchicalKey: string | null;
  updatedAt: string;
}

function toAclKey(entry: {
  itemId: string;
  principalType: VfsAclPrincipalType;
  principalId: string;
}): string {
  return `${entry.itemId}:${entry.principalType}:${entry.principalId}`;
}

function toSortedEffectiveAclView(
  entries: EffectiveVfsAclKeyViewEntry[]
): EffectiveVfsAclKeyViewEntry[] {
  return entries.slice().sort((left, right) => {
    if (left.itemId !== right.itemId) {
      return left.itemId.localeCompare(right.itemId);
    }

    if (left.principalType !== right.principalType) {
      return left.principalType.localeCompare(right.principalType);
    }

    return left.principalId.localeCompare(right.principalId);
  });
}

/**
 * Combines CRDT-authored ACL presence/levels with key-wrapping material from
 * ACL snapshot rows, yielding a client-ready effective ACL key view.
 */
export class InMemoryVfsAccessHarness {
  private readonly crdtReplayStore = new InMemoryVfsCrdtFeedReplayStore();
  private aclSnapshotEntries: VfsAclSnapshotEntry[] = [];

  setAclSnapshotEntries(entries: VfsAclSnapshotEntry[]): void {
    this.aclSnapshotEntries = entries.slice();
  }

  applyCrdtPage(items: VfsCrdtSyncItem[]): void {
    this.crdtReplayStore.applyPage(items);
  }

  getCrdtSnapshot(): VfsCrdtFeedReplaySnapshot {
    return this.crdtReplayStore.snapshot();
  }

  buildEffectiveAclKeyView(
    now: Date = new Date()
  ): EffectiveVfsAclKeyViewEntry[] {
    const crdtSnapshot = this.crdtReplayStore.snapshot();
    const snapshotView = buildVfsAclKeyView(this.aclSnapshotEntries, now);

    const snapshotMap = new Map<string, (typeof snapshotView)[number]>();
    for (const entry of snapshotView) {
      snapshotMap.set(toAclKey(entry), entry);
    }

    const fallbackUpdatedAt =
      crdtSnapshot.cursor?.changedAt ?? now.toISOString();
    const effectiveEntries: EffectiveVfsAclKeyViewEntry[] = [];

    for (const crdtEntry of crdtSnapshot.acl) {
      const key = toAclKey(crdtEntry);
      const snapshotEntry = snapshotMap.get(key);

      effectiveEntries.push({
        itemId: crdtEntry.itemId,
        principalType: crdtEntry.principalType,
        principalId: crdtEntry.principalId,
        accessLevel: crdtEntry.accessLevel,
        wrappedSessionKey: snapshotEntry?.wrappedSessionKey ?? null,
        wrappedHierarchicalKey: snapshotEntry?.wrappedHierarchicalKey ?? null,
        updatedAt: snapshotEntry?.updatedAt ?? fallbackUpdatedAt
      });
    }

    return toSortedEffectiveAclView(effectiveEntries);
  }
}
