import type { VfsCrdtPushOperation } from '@tearleads/shared/gen/tearleads/v2/vfs_pb';
import type { pushCrdtOpsDirect } from './vfsDirectCrdtPush.js';
import type { reconcileCrdtDirect } from './vfsDirectCrdtReconcile.js';
import type {
  VfsCrdtSyncProtoResponse,
  VfsSyncProtoResponse
} from './vfsDirectCrdtRouteHelpers.js';
import {
  decodeOptionalIdentifierBytes,
  decodeRequiredIdentifierBytes,
  encodeIdentifierBytes,
  toDirectPushOperation,
  toProtoAccessLevel,
  toProtoOpType,
  toProtoPrincipalType,
  toProtoPushStatus
} from './vfsServiceSyncAdapterHelpers.js';

export { encodeIdentifierBytes } from './vfsServiceSyncAdapterHelpers.js';

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
    rootId: decodeOptionalIdentifierBytes(request.rootId) ?? ''
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
    rootId: decodeOptionalIdentifierBytes(request.rootId) ?? '',
    ...(request.bloomFilter ? { bloomFilter: request.bloomFilter } : {})
  };
}

export function toDirectPushRequest(request: {
  organizationId: Uint8Array;
  clientId: Uint8Array;
  operations: VfsCrdtPushOperation[];
}): DirectPushCrdtOpsRequest {
  return {
    organizationId: decodeOptionalIdentifierBytes(request.organizationId) ?? '',
    clientId: decodeRequiredIdentifierBytes(request.clientId, 'clientId'),
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
    organizationId: decodeOptionalIdentifierBytes(request.organizationId) ?? '',
    clientId: decodeRequiredIdentifierBytes(request.clientId, 'clientId'),
    cursor: request.cursor,
    lastReconciledWriteIds: request.lastReconciledWriteIds
  };
}

export function toDirectReconcileSyncRequest(request: {
  clientId: Uint8Array;
  cursor: string;
}): DirectReconcileSyncRequest {
  return {
    clientId: decodeRequiredIdentifierBytes(request.clientId, 'clientId'),
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
  const rootId = decodeOptionalIdentifierBytes(request.rootId);

  return {
    organizationId: decodeOptionalIdentifierBytes(request.organizationId) ?? '',
    clientId: decodeRequiredIdentifierBytes(request.clientId, 'clientId'),
    cursor: request.cursor,
    limit: request.limit,
    operations: request.operations.map((operation) =>
      toDirectPushOperation(operation)
    ),
    lastReconciledWriteIds: request.lastReconciledWriteIds,
    ...(rootId ? { rootId } : {}),
    ...(request.bloomFilter ? { bloomFilter: request.bloomFilter } : {})
  };
}
