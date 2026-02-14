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
import type { VfsSyncCursor } from './sync-cursor.js';
import { compareVfsSyncCursorOrder } from './sync-reconcile.js';

export interface EffectiveVfsAclKeyViewEntry {
  itemId: string;
  principalType: VfsAclPrincipalType;
  principalId: string;
  accessLevel: VfsAclAccessLevel;
  wrappedSessionKey: string | null;
  wrappedHierarchicalKey: string | null;
  updatedAt: string;
}

export interface VfsMemberPrincipalView {
  userId: string;
  groupIds: string[];
  organizationIds: string[];
}

export interface EffectiveVfsMemberItemAccessEntry {
  itemId: string;
  accessLevel: VfsAclAccessLevel;
  principalType: VfsAclPrincipalType;
  principalId: string;
  wrappedSessionKey: string | null;
  wrappedHierarchicalKey: string | null;
  updatedAt: string;
}

export interface VfsAuthoritativeMembershipSnapshot {
  cursor: VfsSyncCursor;
  members: VfsMemberPrincipalView[];
}

const ACCESS_RANK: Record<VfsAclAccessLevel, number> = {
  read: 1,
  write: 2,
  admin: 3
};

const PRINCIPAL_SPECIFICITY_RANK: Record<VfsAclPrincipalType, number> = {
  organization: 1,
  group: 2,
  user: 3
};

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

function normalizePrincipalIdSet(values: string[]): Set<string> {
  const normalized = new Set<string>();
  for (const value of values) {
    const trimmed = value.trim();
    if (trimmed.length > 0) {
      normalized.add(trimmed);
    }
  }

  return normalized;
}

function cloneCursor(cursor: VfsSyncCursor): VfsSyncCursor {
  return {
    changedAt: cursor.changedAt,
    changeId: cursor.changeId
  };
}

function normalizeRequiredString(value: unknown, fieldName: string): string {
  if (typeof value !== 'string') {
    throw new Error(`${fieldName} must be a string`);
  }

  const trimmed = value.trim();
  if (trimmed.length === 0) {
    throw new Error(`${fieldName} is required`);
  }

  return trimmed;
}

function normalizeMembershipSnapshotCursor(cursor: VfsSyncCursor): VfsSyncCursor {
  const changedAt = normalizeRequiredString(
    cursor.changedAt,
    'membership snapshot cursor.changedAt'
  );
  const changeId = normalizeRequiredString(
    cursor.changeId,
    'membership snapshot cursor.changeId'
  );

  const changedAtMs = Date.parse(changedAt);
  if (!Number.isFinite(changedAtMs)) {
    throw new Error('membership snapshot cursor.changedAt is invalid');
  }

  return {
    changedAt: new Date(changedAtMs).toISOString(),
    changeId
  };
}

function normalizeMemberPrincipalView(
  principalView: VfsMemberPrincipalView
): VfsMemberPrincipalView {
  const normalizedUserId = principalView.userId.trim();
  if (normalizedUserId.length === 0) {
    throw new Error('principalView.userId is required');
  }

  return {
    userId: normalizedUserId,
    groupIds: Array.from(normalizePrincipalIdSet(principalView.groupIds)),
    organizationIds: Array.from(
      normalizePrincipalIdSet(principalView.organizationIds)
    )
  };
}

function isMemberPrincipalMatch(
  aclEntry: EffectiveVfsAclKeyViewEntry,
  principalView: VfsMemberPrincipalView
): boolean {
  if (aclEntry.principalType === 'user') {
    return aclEntry.principalId === principalView.userId;
  }

  if (aclEntry.principalType === 'group') {
    return principalView.groupIds.some((groupId) => groupId === aclEntry.principalId);
  }

  return principalView.organizationIds.some(
    (organizationId) => organizationId === aclEntry.principalId
  );
}

function compareMemberAccessPriority(
  candidate: EffectiveVfsMemberItemAccessEntry,
  current: EffectiveVfsMemberItemAccessEntry
): number {
  const candidateAccessRank = ACCESS_RANK[candidate.accessLevel];
  const currentAccessRank = ACCESS_RANK[current.accessLevel];
  if (candidateAccessRank !== currentAccessRank) {
    return candidateAccessRank - currentAccessRank;
  }

  const candidateSpecificity = PRINCIPAL_SPECIFICITY_RANK[candidate.principalType];
  const currentSpecificity = PRINCIPAL_SPECIFICITY_RANK[current.principalType];
  if (candidateSpecificity !== currentSpecificity) {
    return candidateSpecificity - currentSpecificity;
  }

  const candidateUpdatedAtMs = Date.parse(candidate.updatedAt);
  const currentUpdatedAtMs = Date.parse(current.updatedAt);
  const normalizedCandidateUpdatedAtMs = Number.isFinite(candidateUpdatedAtMs)
    ? candidateUpdatedAtMs
    : Number.NEGATIVE_INFINITY;
  const normalizedCurrentUpdatedAtMs = Number.isFinite(currentUpdatedAtMs)
    ? currentUpdatedAtMs
    : Number.NEGATIVE_INFINITY;
  if (normalizedCandidateUpdatedAtMs !== normalizedCurrentUpdatedAtMs) {
    return normalizedCandidateUpdatedAtMs - normalizedCurrentUpdatedAtMs;
  }

  if (candidate.principalType !== current.principalType) {
    return candidate.principalType.localeCompare(current.principalType);
  }

  return candidate.principalId.localeCompare(current.principalId);
}

function toSortedMemberAccessView(
  entries: EffectiveVfsMemberItemAccessEntry[]
): EffectiveVfsMemberItemAccessEntry[] {
  return entries.slice().sort((left, right) => left.itemId.localeCompare(right.itemId));
}

/**
 * Combines CRDT-authored ACL presence/levels with key-wrapping material from
 * ACL snapshot rows, yielding a client-ready effective ACL key view.
 */
export class InMemoryVfsAccessHarness {
  private readonly crdtReplayStore = new InMemoryVfsCrdtFeedReplayStore();
  private aclSnapshotEntries: VfsAclSnapshotEntry[] = [];
  private membershipSnapshotCursor: VfsSyncCursor | null = null;
  private membershipPrincipalViewsByUserId = new Map<string, VfsMemberPrincipalView>();

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
    const normalizedCursor = normalizeMembershipSnapshotCursor(snapshot.cursor);
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

  buildEffectiveAccessForUser(
    userId: string,
    now: Date = new Date()
  ): EffectiveVfsMemberItemAccessEntry[] {
    const normalizedUserId = normalizeRequiredString(
      userId,
      'userId'
    );
    const principalView =
      this.membershipPrincipalViewsByUserId.get(normalizedUserId) ?? {
        userId: normalizedUserId,
        groupIds: [],
        organizationIds: []
      };

    /**
     * Guardrail: only memberships from the latest authoritative service-layer
     * snapshot are eligible for group/org grants. Missing users fail closed to
     * direct user ACLs only.
     */
    return this.buildEffectiveAccessForMember(principalView, now);
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
    const winningAccessByItemId: Map<string, EffectiveVfsMemberItemAccessEntry> =
      new Map();
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
}
