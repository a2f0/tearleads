import { create } from '@bufbuild/protobuf';
import type {
  VfsAclAccessLevel,
  VfsCrdtSyncItem,
  VfsCrdtSyncResponse,
  VfsOrgShare,
  VfsPermissionLevel,
  VfsShare,
  VfsSyncItem,
  VfsSyncResponse
} from '@tearleads/shared';
import {
  type VfsOrgSharePayload,
  VfsOrgSharePayloadSchema,
  VfsOrgWrappedKeyPayloadSchema,
  type VfsSharePayload,
  VfsSharePayloadSchema,
  VfsWrappedKeyPayloadSchema
} from '@tearleads/shared/gen/tearleads/v2/vfs_shares_pb';
import { normalizeRequiredString } from './vfsDirectBlobShared.js';

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
  occurredAtMs: number;
  encryptedPayload?: string;
  keyEpoch?: number;
  encryptionNonce?: string;
  encryptionAad?: string;
  encryptionSignature?: string;
  operationSignature?: string;
  actorSigningPublicKey?: string;
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
  };
}

export interface VfsSyncProtoItem {
  changeId: string;
  itemId: string;
  changeType: string;
  changedAtMs: number;
  objectType?: string;
  encryptedName?: string;
  ownerId?: string;
  createdAtMs?: number;
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

export function buildVfsSharesV2ConnectMethodPath(methodName: string): string {
  return `/tearleads.v2.VfsSharesService/${methodName}`;
}

export function extractShareIdFromAclId(aclId: string): string {
  return aclId;
}

export function extractOrgShareIdFromAclId(aclId: string): string {
  return aclId;
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
  rows: Array<{
    replica_id: string | null;
    max_write_id: string | number | null;
  }>
): Record<string, number> {
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
  const occurredAtMs = Date.parse(item.occurredAt);
  const parsed: VfsCrdtSyncProtoItem = {
    opId: item.opId,
    itemId: item.itemId,
    opType: item.opType,
    sourceTable: item.sourceTable,
    sourceId: item.sourceId,
    occurredAtMs: Number.isFinite(occurredAtMs) ? occurredAtMs : 0
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

  const operationSignature = toOptionalString(item.operationSignature);
  if (operationSignature) {
    parsed.operationSignature = operationSignature;
  }

  const actorSigningPublicKey = toOptionalString(item.actorSigningPublicKey);
  if (actorSigningPublicKey) {
    parsed.actorSigningPublicKey = actorSigningPublicKey;
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

  if (response.bloomFilter) {
    parsed.bloomFilter = response.bloomFilter;
  }

  return parsed;
}

function toProtoVfsSyncItem(item: VfsSyncItem): VfsSyncProtoItem {
  const changedAtMs = Date.parse(item.changedAt);
  const parsed: VfsSyncProtoItem = {
    changeId: item.changeId,
    itemId: item.itemId,
    changeType: item.changeType,
    changedAtMs: Number.isFinite(changedAtMs) ? changedAtMs : 0,
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
    const createdAtMs = Date.parse(createdAt);
    if (Number.isFinite(createdAtMs)) {
      parsed.createdAtMs = createdAtMs;
    }
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

export function toProtoVfsCrdtSnapshotResponse(response: {
  replaySnapshot: {
    acl: Array<{
      itemId: string;
      principalType: string;
      principalId: string;
      accessLevel: string;
    }>;
    links: Array<{ parentId: string; childId: string }>;
    cursor?: { changedAt: string; changeId: string } | null;
  };
  containerClocks: Array<{
    containerId: string;
    changedAt: string;
    changeId: string;
  }>;
  snapshotUpdatedAt: string;
  reconcileState?: {
    cursor: { changedAt: string; changeId: string };
    lastReconciledWriteIds: Record<string, number>;
  } | null;
}): VfsCrdtSnapshotProtoResponse {
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

export function mapAclAccessLevelToSharePermissionLevel(
  level: VfsAclAccessLevel
): VfsPermissionLevel {
  switch (level) {
    case 'admin':
      return 'edit'; // Map admin to edit for shares
    case 'write':
      return 'edit';
    default:
      return 'view';
  }
}

export function mapSharePermissionLevelToAclAccessLevel(
  level: VfsPermissionLevel
): VfsAclAccessLevel {
  switch (level) {
    case 'edit':
      return 'write';
    default:
      return 'read';
  }
}

export function toSharePayload(share: VfsShare): VfsSharePayload {
  return create(VfsSharePayloadSchema, {
    id: share.id,
    itemId: share.itemId,
    shareType: share.shareType,
    targetId: share.targetId,
    targetName: share.targetName,
    permissionLevel: share.permissionLevel,
    createdBy: share.createdBy,
    createdByEmail: share.createdByEmail,
    createdAt: share.createdAt,
    ...(typeof share.expiresAt === 'string'
      ? { expiresAt: share.expiresAt }
      : {}),
    ...(share.wrappedKey
      ? {
          wrappedKey: create(VfsWrappedKeyPayloadSchema, {
            recipientUserId: share.wrappedKey.recipientUserId,
            recipientPublicKeyId: share.wrappedKey.recipientPublicKeyId,
            keyEpoch: share.wrappedKey.keyEpoch,
            encryptedKey: share.wrappedKey.encryptedKey,
            senderSignature: share.wrappedKey.senderSignature
          })
        }
      : {})
  });
}

export function toOrgSharePayload(orgShare: VfsOrgShare): VfsOrgSharePayload {
  return create(VfsOrgSharePayloadSchema, {
    id: orgShare.id,
    sourceOrgId: orgShare.sourceOrgId,
    sourceOrgName: orgShare.sourceOrgName,
    targetOrgId: orgShare.targetOrgId,
    targetOrgName: orgShare.targetOrgName,
    itemId: orgShare.itemId,
    permissionLevel: orgShare.permissionLevel,
    createdBy: orgShare.createdBy,
    createdByEmail: orgShare.createdByEmail,
    createdAt: orgShare.createdAt,
    ...(typeof orgShare.expiresAt === 'string'
      ? { expiresAt: orgShare.expiresAt }
      : {}),
    ...(orgShare.wrappedKey
      ? {
          wrappedKey: create(VfsOrgWrappedKeyPayloadSchema, {
            recipientOrgId: orgShare.wrappedKey.recipientOrgId,
            recipientPublicKeyId: orgShare.wrappedKey.recipientPublicKeyId,
            keyEpoch: orgShare.wrappedKey.keyEpoch,
            encryptedKey: orgShare.wrappedKey.encryptedKey,
            senderSignature: orgShare.wrappedKey.senderSignature
          })
        }
      : {})
  });
}
