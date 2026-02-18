import type { VfsAclAccessLevel, VfsAclPrincipalType } from '@tearleads/shared';
import type {
  EffectiveVfsAclKeyViewEntry,
  EffectiveVfsMemberItemAccessEntry,
  VfsMemberPrincipalView
} from './sync-access-harness-types.js';
import type { VfsSyncCursor } from './sync-cursor.js';

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

export function toAclKey(entry: {
  itemId: string;
  principalType: VfsAclPrincipalType;
  principalId: string;
}): string {
  return `${entry.itemId}:${entry.principalType}:${entry.principalId}`;
}

export function toSortedEffectiveAclView(
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

export function normalizePrincipalIdSet(values: string[]): Set<string> {
  const normalized = new Set<string>();
  for (const value of values) {
    const trimmed = value.trim();
    if (trimmed.length > 0) {
      normalized.add(trimmed);
    }
  }

  return normalized;
}

export function cloneCursor(cursor: VfsSyncCursor): VfsSyncCursor {
  return {
    changedAt: cursor.changedAt,
    changeId: cursor.changeId
  };
}

export function normalizeRequiredString(
  value: unknown,
  fieldName: string
): string {
  if (typeof value !== 'string') {
    throw new Error(`${fieldName} must be a string`);
  }

  const trimmed = value.trim();
  if (trimmed.length === 0) {
    throw new Error(`${fieldName} is required`);
  }

  return trimmed;
}

export function normalizeAuthoritativeSnapshotCursor(
  cursor: VfsSyncCursor,
  snapshotName: string
): VfsSyncCursor {
  const changedAt = normalizeRequiredString(
    cursor.changedAt,
    `${snapshotName} cursor.changedAt`
  );
  const changeId = normalizeRequiredString(
    cursor.changeId,
    `${snapshotName} cursor.changeId`
  );

  const changedAtMs = Date.parse(changedAt);
  if (!Number.isFinite(changedAtMs)) {
    throw new Error(`${snapshotName} cursor.changedAt is invalid`);
  }

  return {
    changedAt: new Date(changedAtMs).toISOString(),
    changeId
  };
}

export function normalizeMemberPrincipalView(
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

export function isMemberPrincipalMatch(
  aclEntry: EffectiveVfsAclKeyViewEntry,
  principalView: VfsMemberPrincipalView
): boolean {
  if (aclEntry.principalType === 'user') {
    return aclEntry.principalId === principalView.userId;
  }

  if (aclEntry.principalType === 'group') {
    return principalView.groupIds.some(
      (groupId) => groupId === aclEntry.principalId
    );
  }

  return principalView.organizationIds.some(
    (organizationId) => organizationId === aclEntry.principalId
  );
}

export function compareMemberAccessPriority(
  candidate: EffectiveVfsMemberItemAccessEntry,
  current: EffectiveVfsMemberItemAccessEntry
): number {
  const candidateAccessRank = ACCESS_RANK[candidate.accessLevel];
  const currentAccessRank = ACCESS_RANK[current.accessLevel];
  if (candidateAccessRank !== currentAccessRank) {
    return candidateAccessRank - currentAccessRank;
  }

  const candidateSpecificity =
    PRINCIPAL_SPECIFICITY_RANK[candidate.principalType];
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

export function toSortedMemberAccessView(
  entries: EffectiveVfsMemberItemAccessEntry[]
): EffectiveVfsMemberItemAccessEntry[] {
  return entries
    .slice()
    .sort((left, right) => left.itemId.localeCompare(right.itemId));
}
