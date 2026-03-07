import { getRedisClient } from '@tearleads/shared/redis';
import type { VfsSyncCursor } from '@tearleads/vfs-sync/vfs';
import {
  normalizeReplicaWriteIdRow,
  normalizeReplicaWriteIdRowFromUnknown,
  parseCachedCursorValue
} from './vfsCrdtCacheNormalizers.js';
import {
  cloneCursor,
  isRecord,
  type ReplicaWriteIdRow
} from './vfsCrdtSnapshotCommon.js';

const CACHE_PREFIX = 'vfs:crdt';
const COMPACTION_EPOCH_KEY = `${CACHE_PREFIX}:compactionEpoch`;

const DEFAULT_OLDEST_CURSOR_CACHE_TTL_SECONDS = 30;
const DEFAULT_REPLICA_WRITE_IDS_CACHE_TTL_SECONDS = 15;

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

function getOldestCursorCacheTtlSeconds(): number {
  return parseTtlSeconds(
    process.env['VFS_CRDT_OLDEST_CURSOR_CACHE_TTL_SECONDS'],
    DEFAULT_OLDEST_CURSOR_CACHE_TTL_SECONDS
  );
}

function getReplicaWriteIdsCacheTtlSeconds(): number {
  return parseTtlSeconds(
    process.env['VFS_CRDT_REPLICA_WRITE_IDS_CACHE_TTL_SECONDS'],
    DEFAULT_REPLICA_WRITE_IDS_CACHE_TTL_SECONDS
  );
}

function encodeCachePart(value: string): string {
  return encodeURIComponent(value);
}

function normalizeCompactionEpoch(raw: string | null): string {
  if (!raw) {
    return '0';
  }

  const trimmed = raw.trim();
  if (!/^[0-9]+$/.test(trimmed)) {
    return '0';
  }

  try {
    const parsed = BigInt(trimmed);
    return parsed >= 0n ? parsed.toString() : '0';
  } catch {
    return '0';
  }
}

interface CachedOldestCursorEnvelope {
  cursor: VfsSyncCursor | null;
}

function buildOldestAccessibleCursorCacheKey(input: {
  compactionEpoch: string;
  userId: string;
  rootId: string | null;
}): string {
  return [
    CACHE_PREFIX,
    'oldestCursor',
    encodeCachePart(input.compactionEpoch),
    encodeCachePart(input.userId),
    encodeCachePart(input.rootId ?? '*')
  ].join(':');
}

function buildReplicaWriteIdsCacheKey(userId: string): string {
  return [
    CACHE_PREFIX,
    'replicaWriteIds',
    'heads',
    encodeCachePart(userId)
  ].join(':');
}

export async function getVfsCrdtCompactionEpoch(): Promise<string> {
  try {
    const client = await getRedisClient();
    const raw = await client.get(COMPACTION_EPOCH_KEY);
    return normalizeCompactionEpoch(raw);
  } catch {
    return '0';
  }
}

export async function bumpVfsCrdtCompactionEpoch(): Promise<boolean> {
  try {
    const client = await getRedisClient();
    const currentRaw = await client.get(COMPACTION_EPOCH_KEY);
    const currentEpoch = normalizeCompactionEpoch(currentRaw);
    const nextEpoch = (BigInt(currentEpoch) + 1n).toString();
    await client.set(COMPACTION_EPOCH_KEY, nextEpoch);
    return true;
  } catch {
    return false;
  }
}

export async function readOldestAccessibleCursorCache(input: {
  compactionEpoch: string;
  userId: string;
  rootId: string | null;
}): Promise<VfsSyncCursor | null | undefined> {
  const key = buildOldestAccessibleCursorCacheKey(input);

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

    if (!isRecord(parsed) || !('cursor' in parsed)) {
      return undefined;
    }

    const cursor = parseCachedCursorValue(parsed['cursor']);
    if (parsed['cursor'] !== null && !cursor) {
      return undefined;
    }

    return cursor ? cloneCursor(cursor) : null;
  } catch {
    return undefined;
  }
}

export async function writeOldestAccessibleCursorCache(input: {
  compactionEpoch: string;
  userId: string;
  rootId: string | null;
  cursor: VfsSyncCursor | null;
}): Promise<void> {
  const key = buildOldestAccessibleCursorCacheKey(input);
  const envelope: CachedOldestCursorEnvelope = {
    cursor: input.cursor ? cloneCursor(input.cursor) : null
  };

  try {
    const client = await getRedisClient();
    await client.set(key, JSON.stringify(envelope), {
      EX: getOldestCursorCacheTtlSeconds()
    });
  } catch {
    // best-effort cache write
  }
}

function sanitizeReplicaWriteIdRows(
  rows: ReplicaWriteIdRow[]
): ReplicaWriteIdRow[] {
  const sanitized: ReplicaWriteIdRow[] = [];

  for (const row of rows) {
    const normalizedRow = normalizeReplicaWriteIdRow(row);
    if (!normalizedRow) {
      continue;
    }

    sanitized.push(normalizedRow);
  }

  sanitized.sort((left, right) => {
    const leftId = left.replica_id ?? '';
    const rightId = right.replica_id ?? '';
    return leftId.localeCompare(rightId);
  });

  return sanitized;
}

function parseCachedReplicaWriteIdRows(
  value: unknown
): ReplicaWriteIdRow[] | null {
  if (!Array.isArray(value)) {
    return null;
  }

  const rows: ReplicaWriteIdRow[] = [];
  for (const entry of value) {
    const normalizedRow = normalizeReplicaWriteIdRowFromUnknown(entry);
    if (!normalizedRow) {
      continue;
    }

    rows.push(normalizedRow);
  }

  rows.sort((left, right) => {
    const leftId = left.replica_id ?? '';
    const rightId = right.replica_id ?? '';
    return leftId.localeCompare(rightId);
  });

  return rows;
}

export async function readReplicaWriteIdRowsCache(input: {
  userId: string;
}): Promise<ReplicaWriteIdRow[] | undefined> {
  const key = buildReplicaWriteIdsCacheKey(input.userId);

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

    const rows = parseCachedReplicaWriteIdRows(parsed);
    if (!rows) {
      return undefined;
    }

    return rows;
  } catch {
    return undefined;
  }
}

export async function writeReplicaWriteIdRowsCache(input: {
  userId: string;
  rows: ReplicaWriteIdRow[];
}): Promise<void> {
  const key = buildReplicaWriteIdsCacheKey(input.userId);
  const rows = sanitizeReplicaWriteIdRows(input.rows);

  try {
    const client = await getRedisClient();
    await client.set(key, JSON.stringify(rows), {
      EX: getReplicaWriteIdsCacheTtlSeconds()
    });
  } catch {
    // best-effort cache write
  }
}

export async function invalidateReplicaWriteIdRowsCache(
  userId: string
): Promise<void> {
  try {
    const client = await getRedisClient();
    await client.del(buildReplicaWriteIdsCacheKey(userId));
  } catch {
    // best-effort cache invalidation
  }
}
