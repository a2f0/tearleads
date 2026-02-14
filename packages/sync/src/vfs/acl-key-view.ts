import type { VfsAclAccessLevel, VfsAclPrincipalType } from '@tearleads/shared';

const ACCESS_RANK: Record<VfsAclAccessLevel, number> = {
  read: 1,
  write: 2,
  admin: 3
};

export interface VfsAclSnapshotEntry {
  itemId: string;
  principalType: VfsAclPrincipalType;
  principalId: string;
  accessLevel: VfsAclAccessLevel;
  wrappedSessionKey: string | null;
  wrappedHierarchicalKey: string | null;
  updatedAt: string;
  revokedAt: string | null;
  expiresAt: string | null;
}

export interface VfsAclKeyViewEntry {
  itemId: string;
  principalType: VfsAclPrincipalType;
  principalId: string;
  accessLevel: VfsAclAccessLevel;
  wrappedSessionKey: string | null;
  wrappedHierarchicalKey: string | null;
  updatedAt: string;
}

function isActiveAt(entry: VfsAclSnapshotEntry, nowMs: number): boolean {
  if (entry.revokedAt) {
    return false;
  }

  if (!entry.expiresAt) {
    return true;
  }

  const expiresAtMs = Date.parse(entry.expiresAt);
  return Number.isFinite(expiresAtMs) && expiresAtMs > nowMs;
}

function isNewerEntry(
  candidate: VfsAclSnapshotEntry,
  current: VfsAclKeyViewEntry
): boolean {
  const candidateUpdatedAt = Date.parse(candidate.updatedAt);
  const currentUpdatedAt = Date.parse(current.updatedAt);

  if (candidateUpdatedAt > currentUpdatedAt) {
    return true;
  }

  if (candidateUpdatedAt < currentUpdatedAt) {
    return false;
  }

  return ACCESS_RANK[candidate.accessLevel] > ACCESS_RANK[current.accessLevel];
}

function getEntryKey(entry: {
  itemId: string;
  principalType: VfsAclPrincipalType;
  principalId: string;
}): string {
  return `${entry.itemId}:${entry.principalType}:${entry.principalId}`;
}

export function buildVfsAclKeyView(
  entries: VfsAclSnapshotEntry[],
  now: Date = new Date()
): VfsAclKeyViewEntry[] {
  const nowMs = now.getTime();
  const view = new Map<string, VfsAclKeyViewEntry>();

  for (const entry of entries) {
    if (!isActiveAt(entry, nowMs)) {
      continue;
    }

    const key = getEntryKey(entry);
    const current = view.get(key);

    if (!current) {
      view.set(key, {
        itemId: entry.itemId,
        principalType: entry.principalType,
        principalId: entry.principalId,
        accessLevel: entry.accessLevel,
        wrappedSessionKey: entry.wrappedSessionKey,
        wrappedHierarchicalKey: entry.wrappedHierarchicalKey,
        updatedAt: entry.updatedAt
      });
      continue;
    }

    if (!isNewerEntry(entry, current)) {
      continue;
    }

    view.set(key, {
      itemId: entry.itemId,
      principalType: entry.principalType,
      principalId: entry.principalId,
      accessLevel: entry.accessLevel,
      wrappedSessionKey: entry.wrappedSessionKey ?? current.wrappedSessionKey,
      wrappedHierarchicalKey:
        entry.wrappedHierarchicalKey ?? current.wrappedHierarchicalKey,
      updatedAt: entry.updatedAt
    });
  }

  return [...view.values()];
}
