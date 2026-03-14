import type { VfsCrdtPushOperation } from '@tearleads/shared/gen/tearleads/v2/vfs_pb';
import {
  VfsAclAccessLevel as ProtoVfsAclAccessLevel,
  VfsAclPrincipalType as ProtoVfsAclPrincipalType,
  VfsCrdtOpType as ProtoVfsCrdtOpType,
  VfsCrdtPushStatus as ProtoVfsCrdtPushStatus
} from '@tearleads/shared/gen/tearleads/v2/vfs_pb';
import type { pushCrdtOpsDirect } from './vfsDirectCrdtPush.js';
import type { reconcileCrdtDirect } from './vfsDirectCrdtReconcile.js';
import type {
  VfsCrdtSyncProtoResponse,
  VfsSyncProtoResponse
} from './vfsDirectCrdtRouteHelpers.js';

export type DirectGetSyncRequest = {
  cursor: string;
  limit: number;
  rootId: string;
  bloomFilter?: {
    data: string;
    capacity: number;
    errorRate: number;
  } | null;
};

export type DirectReconcileSyncRequest = { clientId: string; cursor: string };

export type DirectReconcileCrdtRequest = {
  organizationId: string;
  clientId: string;
  cursor: string;
  lastReconciledWriteIds: Record<string, number>;
};

export type DirectPushCrdtOpsRequest = {
  organizationId: string;
  clientId: string;
  operations: unknown[];
};

export type DirectRunCrdtSessionRequest = {
  organizationId: string;
  clientId: string;
  cursor: string;
  limit: number;
  operations: unknown[];
  lastReconciledWriteIds: Record<string, number>;
  rootId?: string | null;
  bloomFilter?: {
    data: string;
    capacity: number;
    errorRate: number;
  } | null;
};

export function encodeIdentifierBytes(value: string): Uint8Array {
  const normalized = value.replace(/-/gu, '');
  if (normalized.length === 32 && /^[0-9a-fA-F]{32}$/u.test(normalized)) {
    const bytes = new Uint8Array(16);
    for (let index = 0; index < 16; index += 1) {
      bytes[index] = Number.parseInt(
        normalized.slice(index * 2, index * 2 + 2),
        16
      );
    }
    return bytes;
  }

  return new TextEncoder().encode(value);
}

function decodeIdentifierBytes(value: Uint8Array): string {
  if (value.length === 16) {
    let hex = '';
    for (const byte of value) {
      hex += byte.toString(16).padStart(2, '0');
    }
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(
      12,
      16
    )}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  }

  return new TextDecoder().decode(value);
}

function decodeOptionalIdentifierBytes(
  value: Uint8Array | undefined
): string | undefined {
  if (!(value instanceof Uint8Array) || value.length === 0) {
    return undefined;
  }

  return decodeIdentifierBytes(value);
}

function toDirectOpType(value: ProtoVfsCrdtOpType): string {
  switch (value) {
    case ProtoVfsCrdtOpType.ACL_ADD:
      return 'acl_add';
    case ProtoVfsCrdtOpType.ACL_REMOVE:
      return 'acl_remove';
    case ProtoVfsCrdtOpType.LINK_ADD:
      return 'link_add';
    case ProtoVfsCrdtOpType.LINK_REMOVE:
      return 'link_remove';
    case ProtoVfsCrdtOpType.ITEM_UPSERT:
      return 'item_upsert';
    case ProtoVfsCrdtOpType.ITEM_DELETE:
      return 'item_delete';
    case ProtoVfsCrdtOpType.LINK_REASSIGN:
      return 'link_reassign';
    default:
      return 'acl_add';
  }
}

function toProtoOpType(value: string): ProtoVfsCrdtOpType {
  switch (value) {
    case 'acl_add':
      return ProtoVfsCrdtOpType.ACL_ADD;
    case 'acl_remove':
      return ProtoVfsCrdtOpType.ACL_REMOVE;
    case 'link_add':
      return ProtoVfsCrdtOpType.LINK_ADD;
    case 'link_remove':
      return ProtoVfsCrdtOpType.LINK_REMOVE;
    case 'item_upsert':
      return ProtoVfsCrdtOpType.ITEM_UPSERT;
    case 'item_delete':
      return ProtoVfsCrdtOpType.ITEM_DELETE;
    case 'link_reassign':
      return ProtoVfsCrdtOpType.LINK_REASSIGN;
    default:
      return ProtoVfsCrdtOpType.UNSPECIFIED;
  }
}

function toDirectPrincipalType(
  value: ProtoVfsAclPrincipalType
): string | undefined {
  switch (value) {
    case ProtoVfsAclPrincipalType.USER:
      return 'user';
    case ProtoVfsAclPrincipalType.GROUP:
      return 'group';
    case ProtoVfsAclPrincipalType.ORGANIZATION:
      return 'organization';
    default:
      return undefined;
  }
}

function toProtoPrincipalType(
  value: string | undefined
): ProtoVfsAclPrincipalType {
  switch (value) {
    case 'user':
      return ProtoVfsAclPrincipalType.USER;
    case 'group':
      return ProtoVfsAclPrincipalType.GROUP;
    case 'organization':
      return ProtoVfsAclPrincipalType.ORGANIZATION;
    default:
      return ProtoVfsAclPrincipalType.UNSPECIFIED;
  }
}

function toDirectAccessLevel(
  value: ProtoVfsAclAccessLevel
): string | undefined {
  switch (value) {
    case ProtoVfsAclAccessLevel.READ:
      return 'read';
    case ProtoVfsAclAccessLevel.WRITE:
      return 'write';
    case ProtoVfsAclAccessLevel.ADMIN:
      return 'admin';
    default:
      return undefined;
  }
}

function toProtoAccessLevel(value: string | undefined): ProtoVfsAclAccessLevel {
  switch (value) {
    case 'read':
      return ProtoVfsAclAccessLevel.READ;
    case 'write':
      return ProtoVfsAclAccessLevel.WRITE;
    case 'admin':
      return ProtoVfsAclAccessLevel.ADMIN;
    default:
      return ProtoVfsAclAccessLevel.UNSPECIFIED;
  }
}

function toProtoPushStatus(value: string): ProtoVfsCrdtPushStatus {
  switch (value) {
    case 'applied':
      return ProtoVfsCrdtPushStatus.APPLIED;
    case 'staleWriteId':
      return ProtoVfsCrdtPushStatus.STALE_WRITE_ID;
    case 'outdatedOp':
      return ProtoVfsCrdtPushStatus.OUTDATED_OP;
    case 'invalidOp':
      return ProtoVfsCrdtPushStatus.INVALID_OP;
    case 'alreadyApplied':
      return ProtoVfsCrdtPushStatus.ALREADY_APPLIED;
    case 'encryptedEnvelopeUnsupported':
      return ProtoVfsCrdtPushStatus.ENCRYPTED_ENVELOPE_UNSUPPORTED;
    case 'aclDenied':
      return ProtoVfsCrdtPushStatus.ACL_DENIED;
    default:
      return ProtoVfsCrdtPushStatus.UNSPECIFIED;
  }
}

function toDirectPushOperation(
  operation: VfsCrdtPushOperation
): Record<string, unknown> {
  const directOperation: Record<string, unknown> = {
    opId: decodeIdentifierBytes(operation.opId),
    opType: toDirectOpType(operation.opType),
    itemId: decodeIdentifierBytes(operation.itemId),
    replicaId: decodeIdentifierBytes(operation.replicaId),
    writeId: Number(operation.writeId),
    occurredAt: new Date(Number(operation.occurredAtMs)).toISOString()
  };

  const principalType = toDirectPrincipalType(operation.principalType);
  if (principalType) {
    directOperation['principalType'] = principalType;
  }

  const principalId = decodeOptionalIdentifierBytes(operation.principalId);
  if (principalId) {
    directOperation['principalId'] = principalId;
  }

  const accessLevel = toDirectAccessLevel(operation.accessLevel);
  if (accessLevel) {
    directOperation['accessLevel'] = accessLevel;
  }

  const parentId = decodeOptionalIdentifierBytes(operation.parentId);
  if (parentId) {
    directOperation['parentId'] = parentId;
  }

  const childId = decodeOptionalIdentifierBytes(operation.childId);
  if (childId) {
    directOperation['childId'] = childId;
  }

  if (typeof operation.encryptedPayload === 'string') {
    directOperation['encryptedPayload'] = operation.encryptedPayload;
  }
  if (typeof operation.keyEpoch === 'number') {
    directOperation['keyEpoch'] = operation.keyEpoch;
  }
  if (typeof operation.encryptionNonce === 'string') {
    directOperation['encryptionNonce'] = operation.encryptionNonce;
  }
  if (typeof operation.encryptionAad === 'string') {
    directOperation['encryptionAad'] = operation.encryptionAad;
  }
  if (typeof operation.encryptionSignature === 'string') {
    directOperation['encryptionSignature'] = operation.encryptionSignature;
  }

  const operationSignature = decodeOptionalIdentifierBytes(
    operation.operationSignature
  );
  if (operationSignature) {
    directOperation['operationSignature'] = operationSignature;
  }

  return directOperation;
}

export function toProtoPushResponse(
  response: Awaited<ReturnType<typeof pushCrdtOpsDirect>>
) {
  return {
    clientId: encodeIdentifierBytes(response.clientId),
    results: response.results.map((result) => ({
      opId: encodeIdentifierBytes(result.opId),
      status: toProtoPushStatus(result.status)
    }))
  };
}

export function toProtoReconcileResponse(
  response: Awaited<ReturnType<typeof reconcileCrdtDirect>>
) {
  return {
    clientId: encodeIdentifierBytes(response.clientId),
    cursor: response.cursor,
    lastReconciledWriteIds: response.lastReconciledWriteIds
  };
}

export function toProtoSyncResponse(response: VfsSyncProtoResponse) {
  return {
    items: response.items.map((item) => ({
      changeId: encodeIdentifierBytes(item.changeId),
      itemId: encodeIdentifierBytes(item.itemId),
      changeType: item.changeType,
      changedAtMs: BigInt(item.changedAtMs),
      ...(item.objectType ? { objectType: item.objectType } : {}),
      ...(item.encryptedName ? { encryptedName: item.encryptedName } : {}),
      ...(item.ownerId ? { ownerId: encodeIdentifierBytes(item.ownerId) } : {}),
      ...(typeof item.createdAtMs === 'number'
        ? { createdAtMs: BigInt(item.createdAtMs) }
        : {}),
      accessLevel: toProtoAccessLevel(item.accessLevel)
    })),
    hasMore: response.hasMore,
    ...(response.nextCursor ? { nextCursor: response.nextCursor } : {})
  };
}

export function toProtoCrdtSyncResponse(response: VfsCrdtSyncProtoResponse) {
  return {
    items: response.items.map((item) => ({
      opId: new Uint8Array(encodeIdentifierBytes(item.opId)),
      itemId: new Uint8Array(encodeIdentifierBytes(item.itemId)),
      opType: toProtoOpType(item.opType),
      principalType: toProtoPrincipalType(item.principalType),
      principalId: item.principalId
        ? new Uint8Array(encodeIdentifierBytes(item.principalId))
        : new Uint8Array(),
      accessLevel: toProtoAccessLevel(item.accessLevel),
      parentId: item.parentId
        ? new Uint8Array(encodeIdentifierBytes(item.parentId))
        : new Uint8Array(),
      childId: item.childId
        ? new Uint8Array(encodeIdentifierBytes(item.childId))
        : new Uint8Array(),
      actorId: item.actorId
        ? new Uint8Array(encodeIdentifierBytes(item.actorId))
        : new Uint8Array(),
      sourceTable: item.sourceTable,
      sourceId: new Uint8Array(encodeIdentifierBytes(item.sourceId)),
      occurredAtMs: BigInt(item.occurredAtMs),
      ...(item.encryptedPayload
        ? { encryptedPayload: item.encryptedPayload }
        : {}),
      ...(typeof item.keyEpoch === 'number' ? { keyEpoch: item.keyEpoch } : {}),
      ...(item.encryptionNonce
        ? { encryptionNonce: item.encryptionNonce }
        : {}),
      ...(item.encryptionAad ? { encryptionAad: item.encryptionAad } : {}),
      ...(item.encryptionSignature
        ? { encryptionSignature: item.encryptionSignature }
        : {})
    })),
    hasMore: response.hasMore,
    lastReconciledWriteIds: response.lastReconciledWriteIds,
    ...(response.nextCursor ? { nextCursor: response.nextCursor } : {}),
    ...(response.bloomFilter ? { bloomFilter: response.bloomFilter } : {})
  };
}

export function toDirectGetSyncRequest(request: {
  cursor: string;
  limit: number;
  rootId: Uint8Array;
}): DirectGetSyncRequest {
  return {
    cursor: request.cursor,
    limit: request.limit,
    rootId: decodeIdentifierBytes(request.rootId)
  };
}

export function toDirectGetCrdtSyncRequest(request: {
  cursor: string;
  limit: number;
  rootId: Uint8Array;
  bloomFilter?: DirectGetSyncRequest['bloomFilter'];
}): DirectGetSyncRequest {
  return {
    cursor: request.cursor,
    limit: request.limit,
    rootId: decodeIdentifierBytes(request.rootId),
    ...(request.bloomFilter ? { bloomFilter: request.bloomFilter } : {})
  };
}

export function toDirectPushRequest(request: {
  organizationId: Uint8Array;
  clientId: Uint8Array;
  operations: VfsCrdtPushOperation[];
}): DirectPushCrdtOpsRequest {
  return {
    organizationId: decodeIdentifierBytes(request.organizationId),
    clientId: decodeIdentifierBytes(request.clientId),
    operations: request.operations.map((operation) =>
      toDirectPushOperation(operation)
    )
  };
}

export function toDirectReconcileCrdtRequest(request: {
  organizationId: Uint8Array;
  clientId: Uint8Array;
  cursor: string;
  lastReconciledWriteIds: Record<string, number>;
}): DirectReconcileCrdtRequest {
  return {
    organizationId: decodeIdentifierBytes(request.organizationId),
    clientId: decodeIdentifierBytes(request.clientId),
    cursor: request.cursor,
    lastReconciledWriteIds: request.lastReconciledWriteIds
  };
}

export function toDirectReconcileSyncRequest(request: {
  clientId: Uint8Array;
  cursor: string;
}): DirectReconcileSyncRequest {
  return {
    clientId: decodeIdentifierBytes(request.clientId),
    cursor: request.cursor
  };
}

export function toDirectRunCrdtSessionRequest(request: {
  organizationId: Uint8Array;
  clientId: Uint8Array;
  cursor: string;
  limit: number;
  operations: VfsCrdtPushOperation[];
  lastReconciledWriteIds: Record<string, number>;
  rootId?: Uint8Array;
  bloomFilter?: DirectRunCrdtSessionRequest['bloomFilter'];
}): DirectRunCrdtSessionRequest {
  return {
    organizationId: decodeIdentifierBytes(request.organizationId),
    clientId: decodeIdentifierBytes(request.clientId),
    cursor: request.cursor,
    limit: request.limit,
    operations: request.operations.map((operation) =>
      toDirectPushOperation(operation)
    ),
    lastReconciledWriteIds: request.lastReconciledWriteIds,
    ...(request.rootId
      ? { rootId: decodeIdentifierBytes(request.rootId) }
      : {}),
    ...(request.bloomFilter ? { bloomFilter: request.bloomFilter } : {})
  };
}
