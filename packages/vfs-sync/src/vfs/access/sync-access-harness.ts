import {
  buildVfsAclKeyView,
  type VfsAclSnapshotEntry
} from './acl-key-view.js';
import {
  cloneCursor,
  compareMemberAccessPriority,
  isMemberPrincipalMatch,
  normalizeAuthoritativeSnapshotCursor,
  normalizeMemberPrincipalView,
  normalizePrincipalIdSet,
  normalizeRequiredString,
  toAclKey,
  toSortedEffectiveAclView,
  toSortedMemberAccessView
} from './sync-access-harness-helpers.js';
import type {
  EffectiveVfsAclKeyViewEntry,
  EffectiveVfsMemberItemAccessEntry,
  VfsAuthoritativeMembershipSnapshot,
  VfsAuthoritativePrincipalCatalogSnapshot,
  VfsMemberPrincipalView
} from './sync-access-harness-types.js';
import type { VfsCrdtSyncItem } from '../protocol/sync-crdt-feed.js';
import {
  InMemoryVfsCrdtFeedReplayStore,
  type VfsCrdtFeedReplaySnapshot
} from '../protocol/sync-crdt-feed-replay.js';
import type { VfsSyncCursor } from '../protocol/sync-cursor.js';
import { compareVfsSyncCursorOrder } from '../protocol/sync-reconcile.js';

/**
 * Combines CRDT-authored ACL presence/levels with key-wrapping material from
 * ACL snapshot rows, yielding a client-ready effective ACL key view.
 */
export class InMemoryVfsAccessHarness {
  private readonly crdtReplayStore = new InMemoryVfsCrdtFeedReplayStore();
  private aclSnapshotEntries: VfsAclSnapshotEntry[] = [];
  private membershipSnapshotCursor: VfsSyncCursor | null = null;
  private membershipPrincipalViewsByUserId = new Map<
    string,
    VfsMemberPrincipalView
  >();
  private principalCatalogCursor: VfsSyncCursor | null = null;
  private activePrincipalCatalog = {
    groupIds: new Set<string>(),
    organizationIds: new Set<string>()
  };

  setAclSnapshotEntries(entries: VfsAclSnapshotEntry[]): void {
    this.aclSnapshotEntries = entries.slice();
  }

  applyCrdtPage(items: VfsCrdtSyncItem[]): void {
    this.crdtReplayStore.applyPage(items);
  }

  getCrdtSnapshot(): VfsCrdtFeedReplaySnapshot {
    return this.crdtReplayStore.snapshot();
  }

  replaceMembershipSnapshot(
    snapshot: VfsAuthoritativeMembershipSnapshot
  ): void {
    const normalizedCursor = normalizeAuthoritativeSnapshotCursor(
      snapshot.cursor,
      'membership snapshot'
    );
    if (
      this.membershipSnapshotCursor &&
      compareVfsSyncCursorOrder(
        normalizedCursor,
        this.membershipSnapshotCursor
      ) < 0
    ) {
      /**
       * Guardrail: service-provided membership snapshots are authoritative for
       * group/org grants. Regressing the snapshot cursor would allow stale cache
       * state to resurrect removed memberships and leak access.
       */
      throw new Error('membership snapshot cursor regressed');
    }

    const normalizedViewsByUserId = new Map<string, VfsMemberPrincipalView>();
    for (const principalView of snapshot.members) {
      const normalizedView = normalizeMemberPrincipalView(principalView);
      if (normalizedViewsByUserId.has(normalizedView.userId)) {
        throw new Error('membership snapshot contains duplicate user entry');
      }
      normalizedViewsByUserId.set(normalizedView.userId, normalizedView);
    }

    this.membershipSnapshotCursor = normalizedCursor;
    this.membershipPrincipalViewsByUserId = normalizedViewsByUserId;
  }

  getMembershipSnapshotCursor(): VfsSyncCursor | null {
    return this.membershipSnapshotCursor
      ? cloneCursor(this.membershipSnapshotCursor)
      : null;
  }

  replacePrincipalCatalogSnapshot(
    snapshot: VfsAuthoritativePrincipalCatalogSnapshot
  ): void {
    const normalizedCursor = normalizeAuthoritativeSnapshotCursor(
      snapshot.cursor,
      'principal catalog snapshot'
    );
    if (
      this.principalCatalogCursor &&
      compareVfsSyncCursorOrder(normalizedCursor, this.principalCatalogCursor) <
        0
    ) {
      /**
       * Guardrail: principal catalog snapshots define which group/org IDs are
       * still valid. Cursor rollback would allow deleted principals to be
       * reintroduced by stale cache state.
       */
      throw new Error('principal catalog snapshot cursor regressed');
    }

    this.principalCatalogCursor = normalizedCursor;
    this.activePrincipalCatalog = {
      groupIds: normalizePrincipalIdSet(snapshot.groupIds),
      organizationIds: normalizePrincipalIdSet(snapshot.organizationIds)
    };
  }

  getPrincipalCatalogCursor(): VfsSyncCursor | null {
    return this.principalCatalogCursor
      ? cloneCursor(this.principalCatalogCursor)
      : null;
  }

  buildEffectiveAccessForUser(
    userId: string,
    now: Date = new Date()
  ): EffectiveVfsMemberItemAccessEntry[] {
    const principalView = this.resolvePrincipalViewForUser(userId);

    /**
     * Guardrail: only memberships from the latest authoritative service-layer
     * snapshot are eligible for group/org grants. Missing users fail closed to
     * direct user ACLs only.
     */
    return this.buildEffectiveAccessForMember(principalView, now);
  }

  buildEffectiveAccessForUserWithInheritance(
    userId: string,
    now: Date = new Date()
  ): EffectiveVfsMemberItemAccessEntry[] {
    const principalView = this.resolvePrincipalViewForUser(userId);
    return this.buildEffectiveAccessForMemberWithInheritance(
      principalView,
      now
    );
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

  buildEffectiveAccessForMember(
    principalView: VfsMemberPrincipalView,
    now: Date = new Date()
  ): EffectiveVfsMemberItemAccessEntry[] {
    const normalizedPrincipalView = normalizeMemberPrincipalView(principalView);

    /**
     * Guardrail: resolve per-item effective access deterministically so user,
     * group, and organization grants always collapse to the same winner.
     * Priority:
     * 1) higher access level,
     * 2) more specific principal (user > group > organization),
     * 3) newer updatedAt,
     * 4) lexical principal tie-breaker.
     */
    const effectiveAclKeyView = this.buildEffectiveAclKeyView(now);
    const winningAccessByItemId: Map<
      string,
      EffectiveVfsMemberItemAccessEntry
    > = new Map();
    for (const aclEntry of effectiveAclKeyView) {
      if (!isMemberPrincipalMatch(aclEntry, normalizedPrincipalView)) {
        continue;
      }

      const candidate: EffectiveVfsMemberItemAccessEntry = {
        itemId: aclEntry.itemId,
        accessLevel: aclEntry.accessLevel,
        principalType: aclEntry.principalType,
        principalId: aclEntry.principalId,
        wrappedSessionKey: aclEntry.wrappedSessionKey,
        wrappedHierarchicalKey: aclEntry.wrappedHierarchicalKey,
        updatedAt: aclEntry.updatedAt
      };
      const current = winningAccessByItemId.get(candidate.itemId);
      if (!current) {
        winningAccessByItemId.set(candidate.itemId, candidate);
        continue;
      }

      if (compareMemberAccessPriority(candidate, current) > 0) {
        winningAccessByItemId.set(candidate.itemId, candidate);
      }
    }

    return toSortedMemberAccessView(Array.from(winningAccessByItemId.values()));
  }

  buildEffectiveAccessForMemberWithInheritance(
    principalView: VfsMemberPrincipalView,
    now: Date = new Date()
  ): EffectiveVfsMemberItemAccessEntry[] {
    const directAccessEntries = this.buildEffectiveAccessForMember(
      principalView,
      now
    );
    const directAccessByItemId = new Map<
      string,
      EffectiveVfsMemberItemAccessEntry
    >();
    for (const directEntry of directAccessEntries) {
      directAccessByItemId.set(directEntry.itemId, directEntry);
    }

    const crdtSnapshot = this.crdtReplayStore.snapshot();
    const parentsByChildId = new Map<string, Set<string>>();
    const allItemIds = new Set<string>(directAccessByItemId.keys());
    for (const link of crdtSnapshot.links) {
      allItemIds.add(link.parentId);
      allItemIds.add(link.childId);
      const parentIds = parentsByChildId.get(link.childId) ?? new Set<string>();
      parentIds.add(link.parentId);
      parentsByChildId.set(link.childId, parentIds);
    }

    const resolvedByItemId = new Map<
      string,
      EffectiveVfsMemberItemAccessEntry | null
    >();
    const resolvingItems = new Set<string>();
    const resolveItemAccess = (
      itemId: string
    ): EffectiveVfsMemberItemAccessEntry | null => {
      if (resolvedByItemId.has(itemId)) {
        return resolvedByItemId.get(itemId) ?? null;
      }

      const directAccess = directAccessByItemId.get(itemId);
      if (directAccess) {
        /**
         * Guardrail: direct ACLs form a subtree boundary. If an item has a
         * direct grant, that decision overrides inherited parent-path access.
         */
        resolvedByItemId.set(itemId, directAccess);
        return directAccess;
      }

      if (resolvingItems.has(itemId)) {
        /**
         * Guardrail: cycles in the link graph are treated as inaccessible for
         * inherited ACLs to avoid non-deterministic privilege decisions.
         */
        resolvedByItemId.set(itemId, null);
        return null;
      }

      const parentIds = parentsByChildId.get(itemId);
      if (!parentIds || parentIds.size === 0) {
        resolvedByItemId.set(itemId, null);
        return null;
      }

      resolvingItems.add(itemId);
      try {
        let inheritedCandidate: EffectiveVfsMemberItemAccessEntry | null = null;
        const sortedParentIds = Array.from(parentIds).sort((left, right) =>
          left.localeCompare(right)
        );
        for (const parentId of sortedParentIds) {
          const parentAccess = resolveItemAccess(parentId);
          if (!parentAccess) {
            /**
             * Guardrail: multi-parent inheritance is fail-closed. Every parent
             * path must remain visible, otherwise the child does not inherit
             * access. This blocks privilege escalation via permissive aliases.
             */
            resolvedByItemId.set(itemId, null);
            return null;
          }

          if (
            !inheritedCandidate ||
            compareMemberAccessPriority(parentAccess, inheritedCandidate) < 0
          ) {
            inheritedCandidate = parentAccess;
          }
        }

        const inheritedAccess = inheritedCandidate
          ? {
              itemId,
              accessLevel: inheritedCandidate.accessLevel,
              principalType: inheritedCandidate.principalType,
              principalId: inheritedCandidate.principalId,
              wrappedSessionKey: inheritedCandidate.wrappedSessionKey,
              wrappedHierarchicalKey: inheritedCandidate.wrappedHierarchicalKey,
              updatedAt: inheritedCandidate.updatedAt
            }
          : null;
        resolvedByItemId.set(itemId, inheritedAccess);
        return inheritedAccess;
      } finally {
        resolvingItems.delete(itemId);
      }
    };

    for (const itemId of allItemIds) {
      resolveItemAccess(itemId);
    }

    const effectiveEntries: EffectiveVfsMemberItemAccessEntry[] = [];
    for (const resolvedEntry of resolvedByItemId.values()) {
      if (resolvedEntry) {
        effectiveEntries.push(resolvedEntry);
      }
    }

    return toSortedMemberAccessView(effectiveEntries);
  }

  private resolvePrincipalViewForUser(userId: string): VfsMemberPrincipalView {
    const normalizedUserId = normalizeRequiredString(userId, 'userId');
    const principalView = this.membershipPrincipalViewsByUserId.get(
      normalizedUserId
    ) ?? {
      userId: normalizedUserId,
      groupIds: [],
      organizationIds: []
    };
    if (!this.principalCatalogCursor) {
      return principalView;
    }

    return {
      userId: principalView.userId,
      groupIds: principalView.groupIds.filter((groupId) =>
        this.activePrincipalCatalog.groupIds.has(groupId)
      ),
      organizationIds: principalView.organizationIds.filter((organizationId) =>
        this.activePrincipalCatalog.organizationIds.has(organizationId)
      )
    };
  }
}

export type {
  EffectiveVfsAclKeyViewEntry,
  EffectiveVfsMemberItemAccessEntry,
  VfsAuthoritativeMembershipSnapshot,
  VfsAuthoritativePrincipalCatalogSnapshot,
  VfsMemberPrincipalView
} from './sync-access-harness-types.js';
