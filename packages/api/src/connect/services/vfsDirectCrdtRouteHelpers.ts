import type {
  VfsCrdtSyncItem,
  VfsCrdtSyncResponse,
  VfsSyncItem,
  VfsSyncResponse
} from '@tearleads/shared';
import type { VfsCrdtRematerializationSnapshot } from '../../lib/vfsCrdtSnapshotCommon.js';
import { normalizeRequiredString } from './vfsDirectBlobShared.js';

interface VfsCrdtReplicaWriteIdRow {
  replica_id: string | null;
  max_write_id: string | number | null;
}

export interface VfsCrdtSyncProtoItem {
  opId: string;
  itemId: string;
  opType: string;
  principalType?: string;
  principalId?: string;
  accessLevel?: string;
  parentId?: string;
  childId?: string;
  actorId?: string;
  sourceTable: string;
  sourceId: string;
  occurredAt: string;
  encryptedPayload?: string;
  keyEpoch?: number;
  encryptionNonce?: string;
  encryptionAad?: string;
  encryptionSignature?: string;
}

export interface VfsCrdtSyncProtoResponse {
  items: VfsCrdtSyncProtoItem[];
  nextCursor?: string;
  hasMore: boolean;
  lastReconciledWriteIds: Record<string, number>;
  bloomFilter?: {
    data: string;
    capacity: number;
    errorRate: number;
  } | null;
}

export interface VfsSyncProtoItem {
  changeId: string;
  itemId: string;
  changeType: string;
  changedAt: string;
  objectType?: string;
  encryptedName?: string;
  ownerId?: string;
  createdAt?: string;
  accessLevel: string;
}

export interface VfsSyncProtoResponse {
  items: VfsSyncProtoItem[];
  nextCursor?: string;
  hasMore: boolean;
}

export interface VfsSnapshotCursorProto {
  changedAt: string;
  changeId: string;
}

export interface VfsSnapshotAclEntryProto {
  itemId: string;
  principalType: string;
  principalId: string;
  accessLevel: string;
}

export interface VfsSnapshotLinkEntryProto {
  parentId: string;
  childId: string;
}

export interface VfsSnapshotReplayProto {
  acl: VfsSnapshotAclEntryProto[];
  links: VfsSnapshotLinkEntryProto[];
  cursor?: VfsSnapshotCursorProto;
}

export interface VfsSnapshotReconcileStateProto {
  cursor: VfsSnapshotCursorProto;
  lastReconciledWriteIds: Record<string, number>;
}

export interface VfsSnapshotContainerClockProto {
  containerId: string;
  changedAt: string;
  changeId: string;
}

export interface VfsCrdtSnapshotProtoResponse {
  replaySnapshot: VfsSnapshotReplayProto;
  reconcileState?: VfsSnapshotReconcileStateProto;
  containerClocks: VfsSnapshotContainerClockProto[];
  snapshotUpdatedAt: string;
}

function parseWriteId(value: unknown): number | null {
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value) || value < 1) {
      return null;
    }

    return value;
  }

  if (typeof value !== 'string') {
    return null;
  }

  if (!/^[0-9]+$/.test(value)) {
    return null;
  }

  const parsed = Number.parseInt(value, 10);
  if (!Number.isSafeInteger(parsed) || parsed < 1) {
    return null;
  }

  return parsed;
}

export function toLastReconciledWriteIds(
  rows: VfsCrdtReplicaWriteIdRow[]
): Record<string, number> {
  /**
   * Guardrail: return a deterministic, sanitized replica clock map.
   * - drop malformed rows (blank replica, non-numeric write ids)
   * - keep only positive integers
   * - sort keys to keep payload stable for downstream snapshot comparisons
   */
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

export function toIsoString(value: Date | string): string | null {
  if (value instanceof Date) {
    return value.toISOString();
  }

  const parsedMs = Date.parse(value);
  if (!Number.isFinite(parsedMs)) {
    return null;
  }

  return new Date(parsedMs).toISOString();
}

function toOptionalString(
  value: string | null | undefined
): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function toProtoCrdtSyncItem(item: VfsCrdtSyncItem): VfsCrdtSyncProtoItem {
  const parsed: VfsCrdtSyncProtoItem = {
    opId: item.opId,
    itemId: item.itemId,
    opType: item.opType,
    sourceTable: item.sourceTable,
    sourceId: item.sourceId,
    occurredAt: item.occurredAt
  };

  const principalType = toOptionalString(item.principalType);
  if (principalType) {
    parsed.principalType = principalType;
  }

  const principalId = toOptionalString(item.principalId);
  if (principalId) {
    parsed.principalId = principalId;
  }

  const accessLevel = toOptionalString(item.accessLevel);
  if (accessLevel) {
    parsed.accessLevel = accessLevel;
  }

  const parentId = toOptionalString(item.parentId);
  if (parentId) {
    parsed.parentId = parentId;
  }

  const childId = toOptionalString(item.childId);
  if (childId) {
    parsed.childId = childId;
  }

  const actorId = toOptionalString(item.actorId);
  if (actorId) {
    parsed.actorId = actorId;
  }

  const encryptedPayload = toOptionalString(item.encryptedPayload);
  if (encryptedPayload) {
    parsed.encryptedPayload = encryptedPayload;
  }

  if (typeof item.keyEpoch === 'number') {
    parsed.keyEpoch = item.keyEpoch;
  }

  const encryptionNonce = toOptionalString(item.encryptionNonce);
  if (encryptionNonce) {
    parsed.encryptionNonce = encryptionNonce;
  }

  const encryptionAad = toOptionalString(item.encryptionAad);
  if (encryptionAad) {
    parsed.encryptionAad = encryptionAad;
  }

  const encryptionSignature = toOptionalString(item.encryptionSignature);
  if (encryptionSignature) {
    parsed.encryptionSignature = encryptionSignature;
  }

  return parsed;
}

export function toProtoVfsCrdtSyncResponse(
  response: VfsCrdtSyncResponse
): VfsCrdtSyncProtoResponse {
  const parsed: VfsCrdtSyncProtoResponse = {
    items: response.items.map((item) => toProtoCrdtSyncItem(item)),
    hasMore: response.hasMore,
    lastReconciledWriteIds: response.lastReconciledWriteIds
  };

  const nextCursor = toOptionalString(response.nextCursor);
  if (nextCursor) {
    parsed.nextCursor = nextCursor;
  }

  if (response.bloomFilter !== undefined) {
    parsed.bloomFilter = response.bloomFilter;
  }

  return parsed;
}

function toProtoVfsSyncItem(item: VfsSyncItem): VfsSyncProtoItem {
  const parsed: VfsSyncProtoItem = {
    changeId: item.changeId,
    itemId: item.itemId,
    changeType: item.changeType,
    changedAt: item.changedAt,
    accessLevel: item.accessLevel
  };

  const objectType = toOptionalString(item.objectType);
  if (objectType) {
    parsed.objectType = objectType;
  }

  const encryptedName = toOptionalString(item.encryptedName);
  if (encryptedName) {
    parsed.encryptedName = encryptedName;
  }

  const ownerId = toOptionalString(item.ownerId);
  if (ownerId) {
    parsed.ownerId = ownerId;
  }

  const createdAt = toOptionalString(item.createdAt);
  if (createdAt) {
    parsed.createdAt = createdAt;
  }

  return parsed;
}

export function toProtoVfsSyncResponse(
  response: VfsSyncResponse
): VfsSyncProtoResponse {
  const parsed: VfsSyncProtoResponse = {
    items: response.items.map((item) => toProtoVfsSyncItem(item)),
    hasMore: response.hasMore
  };

  const nextCursor = toOptionalString(response.nextCursor);
  if (nextCursor) {
    parsed.nextCursor = nextCursor;
  }

  return parsed;
}

function toProtoSnapshotCursor(value: {
  changedAt: string;
  changeId: string;
}): VfsSnapshotCursorProto {
  return {
    changedAt: value.changedAt,
    changeId: value.changeId
  };
}

export function toProtoVfsCrdtSnapshotResponse(
  response: VfsCrdtRematerializationSnapshot
): VfsCrdtSnapshotProtoResponse {
  const parsed: VfsCrdtSnapshotProtoResponse = {
    replaySnapshot: {
      acl: response.replaySnapshot.acl.map((entry) => ({
        itemId: entry.itemId,
        principalType: entry.principalType,
        principalId: entry.principalId,
        accessLevel: entry.accessLevel
      })),
      links: response.replaySnapshot.links.map((entry) => ({
        parentId: entry.parentId,
        childId: entry.childId
      }))
    },
    containerClocks: response.containerClocks.map((entry) => ({
      containerId: entry.containerId,
      changedAt: entry.changedAt,
      changeId: entry.changeId
    })),
    snapshotUpdatedAt: response.snapshotUpdatedAt
  };

  if (response.replaySnapshot.cursor) {
    parsed.replaySnapshot.cursor = toProtoSnapshotCursor(
      response.replaySnapshot.cursor
    );
  }

  if (response.reconcileState) {
    parsed.reconcileState = {
      cursor: toProtoSnapshotCursor(response.reconcileState.cursor),
      lastReconciledWriteIds: {
        ...response.reconcileState.lastReconciledWriteIds
      }
    };
  }

  return parsed;
}
