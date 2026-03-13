import { Buffer } from 'node:buffer';
import type { VfsSyncBloomFilter } from '@tearleads/shared';
import { VfsBloomFilter, type VfsCrdtSyncDbRow } from '@tearleads/vfs-sync/vfs';
import { parseIdentifierWithCompactFallback } from './vfsDirectCrdtCompactDecoding.js';
import { isRecord } from './vfsDirectJson.js';

export function parseLimit(value: unknown): number | null {
  if (typeof value === 'number') {
    if (Number.isInteger(value) && value >= 1 && value <= 500) {
      return value;
    }
    return null;
  }

  if (typeof value === 'string') {
    const parsed = Number.parseInt(value, 10);
    if (Number.isInteger(parsed) && parsed >= 1 && parsed <= 500) {
      return parsed;
    }
  }

  return null;
}

export function parseOptionalRootId(
  value: unknown,
  bytesValue: unknown
): string | null {
  return parseIdentifierWithCompactFallback(value, bytesValue);
}

export function parseBloomFilter(
  value: unknown
):
  | { ok: true; value: VfsSyncBloomFilter | null }
  | { ok: false; error: string } {
  if (value === null || value === undefined) {
    return {
      ok: true,
      value: null
    };
  }
  if (!isRecord(value)) {
    return {
      ok: false,
      error: 'bloomFilter must be an object'
    };
  }

  const data = value['data'];
  const capacity = value['capacity'];
  const errorRate = value['errorRate'];

  if (typeof data !== 'string' || data.trim().length === 0) {
    return {
      ok: false,
      error: 'bloomFilter.data must be a non-empty base64 string'
    };
  }
  if (
    typeof capacity !== 'number' ||
    !Number.isInteger(capacity) ||
    capacity < 1 ||
    capacity > 1_000_000
  ) {
    return {
      ok: false,
      error: 'bloomFilter.capacity must be a positive integer'
    };
  }
  if (
    typeof errorRate !== 'number' ||
    !Number.isFinite(errorRate) ||
    errorRate <= 0 ||
    errorRate >= 1
  ) {
    return {
      ok: false,
      error: 'bloomFilter.errorRate must be a number between 0 and 1'
    };
  }

  return {
    ok: true,
    value: {
      data: data.trim(),
      capacity,
      errorRate
    }
  };
}

function parseRowWriteId(value: unknown): number | null {
  if (typeof value === 'number') {
    if (Number.isSafeInteger(value) && value >= 1) {
      return value;
    }
    return null;
  }

  if (typeof value === 'string' && /^[0-9]+$/u.test(value)) {
    const parsed = Number.parseInt(value, 10);
    if (Number.isSafeInteger(parsed) && parsed >= 1) {
      return parsed;
    }
  }

  return null;
}

export function createRuntimeBloomFilter(
  bloomFilter: VfsSyncBloomFilter | null
): VfsBloomFilter | null {
  if (!bloomFilter) {
    return null;
  }

  try {
    const data = Buffer.from(bloomFilter.data, 'base64');
    if (data.length === 0) {
      return null;
    }
    return VfsBloomFilter.fromUint8Array(new Uint8Array(data), {
      capacity: bloomFilter.capacity,
      errorRate: bloomFilter.errorRate
    });
  } catch {
    return null;
  }
}

export function shouldPruneSessionRow(
  row: VfsCrdtSyncDbRow,
  input: {
    runtimeBloomFilter: VfsBloomFilter | null;
    lastReconciledWriteIds: Record<string, number>;
  }
): boolean {
  if (!input.runtimeBloomFilter) {
    return false;
  }

  const replicaId = row.replica_id;
  if (typeof replicaId !== 'string' || replicaId.trim().length === 0) {
    return false;
  }
  const writeId = parseRowWriteId(row.write_id);
  if (writeId === null) {
    return false;
  }

  const reconciledWriteId = input.lastReconciledWriteIds[replicaId] ?? 0;
  if (reconciledWriteId < writeId) {
    return false;
  }

  return input.runtimeBloomFilter.has(row.op_id);
}

export function mergeLastReconciledWriteIds(
  ...sources: Record<string, number>[]
): Record<string, number> {
  const merged = new Map<string, number>();

  for (const source of sources) {
    for (const [replicaId, writeId] of Object.entries(source)) {
      const existing = merged.get(replicaId) ?? 0;
      if (writeId > existing) {
        merged.set(replicaId, writeId);
      }
    }
  }

  const sortedEntries = Array.from(merged.entries()).sort((left, right) =>
    left[0].localeCompare(right[0])
  );
  return Object.fromEntries(sortedEntries);
}
