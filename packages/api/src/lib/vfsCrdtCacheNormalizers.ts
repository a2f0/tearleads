import type { VfsSyncCursor } from '@tearleads/vfs-sync/vfs';
import {
  isRecord,
  normalizeRequiredString,
  parseCursor,
  type ReplicaWriteIdRow
} from './vfsCrdtSnapshotCommon.js';

export function parseCachedCursorValue(value: unknown): VfsSyncCursor | null {
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

function normalizeMaxWriteId(
  value: unknown,
  allowUndefinedAsNull: boolean
): string | number | null | undefined {
  if (value === null || value === undefined) {
    return allowUndefinedAsNull ? null : undefined;
  }

  if (typeof value === 'number') {
    if (Number.isFinite(value) && Number.isInteger(value)) {
      return value;
    }
    return undefined;
  }

  if (typeof value !== 'string') {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function normalizeReplicaWriteIdRow(
  row: ReplicaWriteIdRow
): ReplicaWriteIdRow | null {
  const replicaId = normalizeRequiredString(row.replica_id);
  const maxWriteId = normalizeMaxWriteId(row.max_write_id, true);
  if (maxWriteId === undefined) {
    return null;
  }

  return {
    replica_id: replicaId,
    max_write_id: maxWriteId
  };
}

export function normalizeReplicaWriteIdRowFromUnknown(
  value: unknown
): ReplicaWriteIdRow | null {
  if (!isRecord(value)) {
    return null;
  }

  const replicaId = normalizeRequiredString(value['replica_id']);
  const maxWriteId = normalizeMaxWriteId(value['max_write_id'], true);
  if (maxWriteId === undefined) {
    return null;
  }

  return {
    replica_id: replicaId,
    max_write_id: maxWriteId
  };
}
