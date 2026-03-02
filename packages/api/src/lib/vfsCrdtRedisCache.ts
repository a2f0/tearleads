import { getRedisClient } from '@tearleads/shared/redis';
import type { VfsSyncCursor } from '@tearleads/vfs-sync/vfs';
import {
  cloneCursor,
  isRecord,
  normalizeRequiredString,
  parseCursor,
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

export type ReplicaWriteIdCacheMode = 'heads' | 'legacy';

interface CachedOldestCursorEnvelope {
  cursor: VfsSyncCursor | null;
}

export function buildOldestAccessibleCursorCacheKey(input: {
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

export function buildReplicaWriteIdsCacheKey(input: {
  userId: string;
  mode: ReplicaWriteIdCacheMode;
}): string {
  return [
    CACHE_PREFIX,
    'replicaWriteIds',
    input.mode,
    encodeCachePart(input.userId)
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

function parseCachedCursor(value: unknown): VfsSyncCursor | null {
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

    const cursor = parseCachedCursor(parsed['cursor']);
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
    const replicaId = normalizeRequiredString(row.replica_id);

    let maxWriteId: string | number | null = null;
    if (row.max_write_id === null || row.max_write_id === undefined) {
      maxWriteId = null;
    } else if (typeof row.max_write_id === 'number') {
      if (
        Number.isFinite(row.max_write_id) &&
        Number.isInteger(row.max_write_id)
      ) {
        maxWriteId = row.max_write_id;
      }
    } else if (typeof row.max_write_id === 'string') {
      const trimmed = row.max_write_id.trim();
      maxWriteId = trimmed.length > 0 ? trimmed : null;
    }

    if (
      row.max_write_id !== null &&
      row.max_write_id !== undefined &&
      maxWriteId === null
    ) {
      continue;
    }

    sanitized.push({
      replica_id: replicaId,
      max_write_id: maxWriteId
    });
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
    if (!isRecord(entry)) {
      continue;
    }

    const replicaId = normalizeRequiredString(entry['replica_id']);

    const rawMaxWriteId = entry['max_write_id'];
    let maxWriteId: string | number | null = null;
    if (rawMaxWriteId === null || rawMaxWriteId === undefined) {
      maxWriteId = null;
    } else if (
      typeof rawMaxWriteId === 'number' &&
      Number.isFinite(rawMaxWriteId) &&
      Number.isInteger(rawMaxWriteId)
    ) {
      maxWriteId = rawMaxWriteId;
    } else if (typeof rawMaxWriteId === 'string') {
      const trimmed = rawMaxWriteId.trim();
      maxWriteId = trimmed.length > 0 ? trimmed : null;
    } else {
      continue;
    }

    rows.push({
      replica_id: replicaId,
      max_write_id: maxWriteId
    });
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
  mode: ReplicaWriteIdCacheMode;
}): Promise<ReplicaWriteIdRow[] | undefined> {
  const key = buildReplicaWriteIdsCacheKey(input);

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
  mode: ReplicaWriteIdCacheMode;
  rows: ReplicaWriteIdRow[];
}): Promise<void> {
  const key = buildReplicaWriteIdsCacheKey(input);
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
    await client.del(
      buildReplicaWriteIdsCacheKey({
        userId,
        mode: 'heads'
      })
    );
    await client.del(
      buildReplicaWriteIdsCacheKey({
        userId,
        mode: 'legacy'
      })
    );
  } catch {
    // best-effort cache invalidation
  }
}
