import type {
  VfsAclAccessLevel,
  VfsAclPrincipalType
} from '@tearleads/shared';
import {
  compareVfsSyncCursorOrder,
  type VfsCrdtLastReconciledWriteIds,
  type VfsSyncCursor
} from '@tearleads/vfs-sync/vfs';

export const CRDT_CLIENT_PUSH_SOURCE_TABLE = 'vfs_crdt_client_push';
export const VFS_CRDT_SNAPSHOT_SCOPE = 'global';

export interface QueryResultRow<T> {
  rows: T[];
}

export interface PgQueryable {
  query<T>(text: string, values?: unknown[]): Promise<QueryResultRow<T>>;
}

export interface CursorRow {
  occurred_at: Date | string;
  id: string;
}

export interface SnapshotRow {
  snapshot_payload: unknown;
  snapshot_cursor_changed_at: Date | string | null;
  snapshot_cursor_change_id: string | null;
  updated_at: Date | string;
}

export interface SnapshotUpdatedAtRow {
  updated_at: Date | string;
}

export interface AclSnapshotRow {
  item_id: string;
  principal_type: string;
  principal_id: string;
  access_level: string;
}

export interface LinkSnapshotRow {
  parent_id: string;
  child_id: string;
}

export interface ContainerClockRow {
  container_id: string;
  changed_at: Date | string;
  change_id: string;
}

export interface VisibleItemRow {
  item_id: string;
}

export interface ClientStateRow {
  last_reconciled_at: Date | string;
  last_reconciled_change_id: string;
  last_reconciled_write_ids: unknown;
}

export interface ReplicaWriteIdRow {
  replica_id: string | null;
  max_write_id: string | number | null;
}

export interface VfsCrdtSnapshotReplayPayload {
  acl: Array<{
    itemId: string;
    principalType: VfsAclPrincipalType;
    principalId: string;
    accessLevel: VfsAclAccessLevel;
  }>;
  links: Array<{
    parentId: string;
    childId: string;
  }>;
  cursor: VfsSyncCursor | null;
}

export interface VfsCrdtSnapshotPayload {
  replaySnapshot: VfsCrdtSnapshotReplayPayload;
  containerClocks: Array<{
    containerId: string;
    changedAt: string;
    changeId: string;
  }>;
}

export interface VfsCrdtSnapshotRefreshResult {
  scope: string;
  updatedAt: string;
  cursor: VfsSyncCursor | null;
  aclEntries: number;
  links: number;
  containerClocks: number;
}

export interface VfsCrdtRematerializationSnapshot {
  replaySnapshot: VfsCrdtSnapshotReplayPayload;
  reconcileState: {
    cursor: VfsSyncCursor;
    lastReconciledWriteIds: VfsCrdtLastReconciledWriteIds;
  } | null;
  containerClocks: Array<{
    containerId: string;
    changedAt: string;
    changeId: string;
  }>;
  snapshotUpdatedAt: string;
}

export function normalizeRequiredString(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function parseOccurredAt(value: Date | string | null): string | null {
  if (value === null) {
    return null;
  }

  if (value instanceof Date) {
    const asMs = value.getTime();
    if (!Number.isFinite(asMs)) {
      return null;
    }
    return value.toISOString();
  }

  const parsedMs = Date.parse(value);
  if (!Number.isFinite(parsedMs)) {
    return null;
  }

  return new Date(parsedMs).toISOString();
}

export function parseCursor(
  occurredAt: Date | string | null,
  changeId: string | null
): VfsSyncCursor | null {
  const changedAt = parseOccurredAt(occurredAt);
  const normalizedChangeId = normalizeRequiredString(changeId);
  if (!changedAt || !normalizedChangeId) {
    return null;
  }

  return {
    changedAt,
    changeId: normalizedChangeId
  };
}

export function isPrincipalType(value: unknown): value is VfsAclPrincipalType {
  return value === 'user' || value === 'group' || value === 'organization';
}

export function isAccessLevel(value: unknown): value is VfsAclAccessLevel {
  return value === 'read' || value === 'write' || value === 'admin';
}

function parseWriteId(value: unknown): number | null {
  if (typeof value === 'number') {
    if (!Number.isInteger(value) || !Number.isFinite(value) || value < 1) {
      return null;
    }
    return value;
  }

  if (typeof value !== 'string') {
    return null;
  }

  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || !Number.isFinite(parsed) || parsed < 1) {
    return null;
  }

  return parsed;
}

export function normalizeReplicaWriteIds(
  rows: ReplicaWriteIdRow[]
): VfsCrdtLastReconciledWriteIds {
  const entries: Array<[string, number]> = [];
  for (const row of rows) {
    const replicaId = normalizeRequiredString(row.replica_id);
    const writeId = parseWriteId(row.max_write_id);
    if (!replicaId || writeId === null) {
      continue;
    }
    entries.push([replicaId, writeId]);
  }

  entries.sort((left, right) => left[0].localeCompare(right[0]));
  return Object.fromEntries(entries);
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function parseLastReconciledWriteIds(
  value: unknown
): VfsCrdtLastReconciledWriteIds {
  let candidate: unknown = value;
  if (typeof candidate === 'string') {
    try {
      candidate = JSON.parse(candidate);
    } catch {
      return {};
    }
  }

  if (!isRecord(candidate)) {
    return {};
  }

  const entries: Array<[string, number]> = [];
  for (const [rawReplicaId, rawWriteId] of Object.entries(candidate)) {
    const replicaId = normalizeRequiredString(rawReplicaId);
    const writeId = parseWriteId(rawWriteId);
    if (!replicaId || writeId === null) {
      continue;
    }
    entries.push([replicaId, writeId]);
  }

  entries.sort((left, right) => left[0].localeCompare(right[0]));
  return Object.fromEntries(entries);
}

export function mergeWriteIds(
  left: VfsCrdtLastReconciledWriteIds,
  right: VfsCrdtLastReconciledWriteIds
): VfsCrdtLastReconciledWriteIds {
  const merged = new Map<string, number>();

  for (const [replicaId, writeId] of Object.entries(left)) {
    merged.set(replicaId, writeId);
  }
  for (const [replicaId, writeId] of Object.entries(right)) {
    const previous = merged.get(replicaId) ?? 0;
    merged.set(replicaId, Math.max(previous, writeId));
  }

  return Object.fromEntries(
    Array.from(merged.entries()).sort((a, b) => a[0].localeCompare(b[0]))
  );
}

export function pickNewerCursor(
  left: VfsSyncCursor | null,
  right: VfsSyncCursor | null
): VfsSyncCursor | null {
  if (!left) {
    return right ? cloneCursor(right) : null;
  }
  if (!right) {
    return cloneCursor(left);
  }

  return compareVfsSyncCursorOrder(left, right) >= 0
    ? cloneCursor(left)
    : cloneCursor(right);
}

export function cloneCursor(cursor: VfsSyncCursor): VfsSyncCursor {
  return {
    changedAt: cursor.changedAt,
    changeId: cursor.changeId
  };
}

export function cloneWriteIds(
  value: VfsCrdtLastReconciledWriteIds
): VfsCrdtLastReconciledWriteIds {
  return Object.fromEntries(
    Object.entries(value).map(([replicaId, writeId]) => [replicaId, writeId])
  );
}
