import { getRedisClient } from '@tearleads/shared/redis';
import {
  cloneCursor,
  isAccessLevel,
  isPrincipalType,
  isRecord,
  normalizeRequiredString,
  parseCursor,
  parseOccurredAt,
  type VfsCrdtSnapshotPayload,
  type VfsCrdtSnapshotReplayPayload
} from './vfsCrdtSnapshotCommon.js';

const CACHE_PREFIX = 'vfs:crdt';
const DEFAULT_REMAT_SNAPSHOT_CACHE_TTL_SECONDS = 30;

function parseTtlSeconds(value: string | undefined, fallback: number): number {
  if (!value) {
    return fallback;
  }

  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || !Number.isInteger(parsed) || parsed < 1) {
    return fallback;
  }

  return parsed;
}

function getRematerializationSnapshotCacheTtlSeconds(): number {
  return parseTtlSeconds(
    process.env['VFS_CRDT_REMAT_SNAPSHOT_CACHE_TTL_SECONDS'],
    DEFAULT_REMAT_SNAPSHOT_CACHE_TTL_SECONDS
  );
}

function encodeCachePart(value: string): string {
  return encodeURIComponent(value);
}

interface CachedRematerializationSnapshot {
  replaySnapshot: VfsCrdtSnapshotReplayPayload;
  containerClocks: VfsCrdtSnapshotPayload['containerClocks'];
}

function buildRematerializationSnapshotCacheKey(input: {
  scope: string;
  userId: string;
  clientId: string;
  snapshotUpdatedAt: string;
}): string {
  return [
    CACHE_PREFIX,
    'rematSnapshot',
    encodeCachePart(input.scope),
    encodeCachePart(input.userId),
    encodeCachePart(input.clientId),
    encodeCachePart(input.snapshotUpdatedAt)
  ].join(':');
}

function parseCachedCursor(value: unknown) {
  if (value === null) {
    return null;
  }

  if (!isRecord(value)) {
    return null;
  }

  const changedAt = normalizeRequiredString(value['changedAt']);
  const changeId = normalizeRequiredString(value['changeId']);
  if (!changedAt || !changeId) {
    return null;
  }

  return parseCursor(changedAt, changeId);
}

function parseCachedReplaySnapshot(
  value: unknown
): VfsCrdtSnapshotReplayPayload | null {
  if (!isRecord(value)) {
    return null;
  }

  const aclValue = value['acl'];
  const linksValue = value['links'];
  if (!Array.isArray(aclValue) || !Array.isArray(linksValue)) {
    return null;
  }

  const acl: VfsCrdtSnapshotReplayPayload['acl'] = [];
  for (const entry of aclValue) {
    if (!isRecord(entry)) {
      continue;
    }

    const itemId = normalizeRequiredString(entry['itemId']);
    const principalType = isPrincipalType(entry['principalType'])
      ? entry['principalType']
      : null;
    const principalId = normalizeRequiredString(entry['principalId']);
    const accessLevel = isAccessLevel(entry['accessLevel'])
      ? entry['accessLevel']
      : null;

    if (!itemId || !principalType || !principalId || !accessLevel) {
      continue;
    }

    acl.push({
      itemId,
      principalType,
      principalId,
      accessLevel
    });
  }

  const links: VfsCrdtSnapshotReplayPayload['links'] = [];
  for (const entry of linksValue) {
    if (!isRecord(entry)) {
      continue;
    }

    const parentId = normalizeRequiredString(entry['parentId']);
    const childId = normalizeRequiredString(entry['childId']);
    if (!parentId || !childId) {
      continue;
    }

    links.push({
      parentId,
      childId
    });
  }

  const cursor = parseCachedCursor(value['cursor']);
  if (value['cursor'] !== null && value['cursor'] !== undefined && !cursor) {
    return null;
  }

  return {
    acl,
    links,
    cursor: cursor ? cloneCursor(cursor) : null
  };
}

function parseCachedContainerClocks(
  value: unknown
): VfsCrdtSnapshotPayload['containerClocks'] | null {
  if (!Array.isArray(value)) {
    return null;
  }

  const entries: VfsCrdtSnapshotPayload['containerClocks'] = [];
  for (const entry of value) {
    if (!isRecord(entry)) {
      continue;
    }

    const containerId = normalizeRequiredString(entry['containerId']);
    const changedAt = parseOccurredAt(
      typeof entry['changedAt'] === 'string' ? entry['changedAt'] : null
    );
    const changeId = normalizeRequiredString(entry['changeId']);
    if (!containerId || !changedAt || !changeId) {
      continue;
    }

    entries.push({
      containerId,
      changedAt,
      changeId
    });
  }

  return entries;
}

function cloneCachedRematerializationSnapshot(
  value: CachedRematerializationSnapshot
): CachedRematerializationSnapshot {
  return {
    replaySnapshot: {
      acl: value.replaySnapshot.acl.map((entry) => ({
        itemId: entry.itemId,
        principalType: entry.principalType,
        principalId: entry.principalId,
        accessLevel: entry.accessLevel
      })),
      links: value.replaySnapshot.links.map((entry) => ({
        parentId: entry.parentId,
        childId: entry.childId
      })),
      cursor: value.replaySnapshot.cursor
        ? cloneCursor(value.replaySnapshot.cursor)
        : null
    },
    containerClocks: value.containerClocks.map((entry) => ({
      containerId: entry.containerId,
      changedAt: entry.changedAt,
      changeId: entry.changeId
    }))
  };
}

function parseCachedRematerializationSnapshot(
  value: unknown
): CachedRematerializationSnapshot | null {
  if (!isRecord(value)) {
    return null;
  }

  const replaySnapshot = parseCachedReplaySnapshot(value['replaySnapshot']);
  const containerClocks = parseCachedContainerClocks(value['containerClocks']);
  if (!replaySnapshot || !containerClocks) {
    return null;
  }

  return {
    replaySnapshot,
    containerClocks
  };
}

export async function readRematerializationSnapshotCache(input: {
  scope: string;
  userId: string;
  clientId: string;
  snapshotUpdatedAt: string;
}): Promise<CachedRematerializationSnapshot | undefined> {
  const key = buildRematerializationSnapshotCacheKey(input);

  try {
    const client = await getRedisClient();
    const raw = await client.get(key);
    if (raw === null) {
      return undefined;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return undefined;
    }

    const snapshot = parseCachedRematerializationSnapshot(parsed);
    if (!snapshot) {
      return undefined;
    }

    return cloneCachedRematerializationSnapshot(snapshot);
  } catch {
    return undefined;
  }
}

export async function writeRematerializationSnapshotCache(input: {
  scope: string;
  userId: string;
  clientId: string;
  snapshotUpdatedAt: string;
  snapshot: CachedRematerializationSnapshot;
}): Promise<void> {
  const key = buildRematerializationSnapshotCacheKey(input);

  try {
    const client = await getRedisClient();
    await client.set(
      key,
      JSON.stringify(cloneCachedRematerializationSnapshot(input.snapshot)),
      {
        EX: getRematerializationSnapshotCacheTtlSeconds()
      }
    );
  } catch {
    // best-effort cache write
  }
}
