import type {
  VfsCrdtPushRequest,
  VfsCrdtPushResponse,
  VfsCrdtReconcileRequest,
  VfsCrdtReconcileResponse,
  VfsCrdtSyncResponse,
  VfsCrdtSyncSessionRequest,
  VfsCrdtSyncSessionResponse,
  VfsSyncBloomFilter
} from '@tearleads/shared';
import type protobuf from 'protobufjs';
import {
  asRecord,
  decodeBase64ToBytes,
  decodePushOperation,
  decodeSyncItem,
  encodeBytesToBase64,
  normalizeOptionalBytes,
  normalizeOptionalBytesString,
  normalizePositiveSafeInteger,
  normalizePushStatus,
  normalizeRequiredBytes,
  normalizeWriteIdMap,
  packUuidToBytes,
  toOperationPayload,
  toPushStatus
} from './syncProtobufNormalization.js';
import {
  PULL_RESPONSE_TYPE,
  PUSH_REQUEST_TYPE,
  PUSH_RESPONSE_TYPE,
  RECONCILE_REQUEST_TYPE,
  RECONCILE_RESPONSE_TYPE,
  SYNC_SESSION_REQUEST_TYPE,
  SYNC_SESSION_RESPONSE_TYPE
} from './syncProtobufSchema.js';

function toObject(
  type: protobuf.Type,
  bytes: Uint8Array
): Record<string, unknown> {
  const decoded = type.decode(bytes);
  return asRecord(
    type.toObject(decoded, {
      longs: Number,
      enums: String,
      defaults: false,
      arrays: true,
      objects: true,
      bytes: Array
    }),
    'message'
  );
}
function encode(
  type: protobuf.Type,
  payload: Record<string, unknown>
): Uint8Array {
  const verified = type.verify(payload);
  if (verified) {
    throw new Error(`invalid protobuf payload: ${verified}`);
  }
  return type.encode(type.create(payload)).finish();
}

function toBloomFilterPayload(
  filter: VfsSyncBloomFilter
): Record<string, unknown> {
  const data = decodeBase64ToBytes(filter.data);
  if (!data) {
    throw new Error('invalid bloom filter data (must be base64)');
  }
  return {
    data,
    capacity: filter.capacity,
    errorRate: filter.errorRate
  };
}

function decodeBloomFilter(value: unknown): VfsSyncBloomFilter | null {
  if (!value) return null;
  const filter = asRecord(value, 'bloomFilter');
  const dataBytes = normalizeOptionalBytes(filter['data']);
  if (!dataBytes) return null;

  return {
    data: encodeBytesToBase64(dataBytes),
    capacity: normalizePositiveSafeInteger(
      filter['capacity'],
      'bloomFilter.capacity'
    ),
    errorRate: Number(filter['errorRate'])
  };
}

export function encodeVfsCrdtPushRequestProtobuf(
  request: VfsCrdtPushRequest
): Uint8Array {
  return encode(PUSH_REQUEST_TYPE, {
    organizationId: request.organizationId
      ? packUuidToBytes(request.organizationId)
      : [],
    clientId: packUuidToBytes(request.clientId),
    operations: request.operations.map((operation) =>
      toOperationPayload(operation)
    )
  });
}
export function decodeVfsCrdtPushRequestProtobuf(bytes: Uint8Array): unknown {
  const payload = toObject(PUSH_REQUEST_TYPE, bytes);
  const operations = Array.isArray(payload['operations'])
    ? payload['operations'].map((operation) => decodePushOperation(operation))
    : [];
  return {
    organizationId:
      normalizeOptionalBytesString(payload['organizationId']) ?? null,
    clientId: normalizeRequiredBytes(payload['clientId'], 'clientId'),
    operations
  };
}
export function encodeVfsCrdtPushResponseProtobuf(
  response: VfsCrdtPushResponse
): Uint8Array {
  return encode(PUSH_RESPONSE_TYPE, {
    clientId: packUuidToBytes(response.clientId),
    results: response.results.map((result) => ({
      opId: packUuidToBytes(result.opId),
      status: toPushStatus(result.status)
    }))
  });
}
export function decodeVfsCrdtPushResponseProtobuf(bytes: Uint8Array): unknown {
  const payload = toObject(PUSH_RESPONSE_TYPE, bytes);
  const rawResults = Array.isArray(payload['results'])
    ? payload['results']
    : [];
  return {
    clientId: normalizeRequiredBytes(payload['clientId'], 'clientId'),
    results: rawResults.map((entry) => {
      const result = asRecord(entry, 'results[]');
      return {
        opId: normalizeRequiredBytes(result['opId'], 'results[].opId'),
        status: normalizePushStatus(result['status'])
      };
    })
  };
}
export function encodeVfsCrdtSyncResponseProtobuf(
  response: VfsCrdtSyncResponse
): Uint8Array {
  const payload: Record<string, unknown> = {
    items: response.items.map((item) => toOperationPayload(item)),
    hasMore: response.hasMore,
    nextCursor: response.nextCursor ?? '',
    lastReconciledWriteIds: response.lastReconciledWriteIds
  };
  if (response.bloomFilter) {
    payload['bloomFilter'] = toBloomFilterPayload(response.bloomFilter);
  }
  return encode(PULL_RESPONSE_TYPE, payload);
}
export function decodeVfsCrdtSyncResponseProtobuf(bytes: Uint8Array): unknown {
  const payload = toObject(PULL_RESPONSE_TYPE, bytes);
  const rawItems = Array.isArray(payload['items']) ? payload['items'] : [];
  const nextCursor = (payload['nextCursor'] as string) || null;
  const hasMore = payload['hasMore'] === true;
  return {
    items: rawItems.map((entry) => decodeSyncItem(entry)),
    hasMore,
    nextCursor: nextCursor && nextCursor.length > 0 ? nextCursor : null,
    lastReconciledWriteIds: normalizeWriteIdMap(
      payload['lastReconciledWriteIds']
    ),
    bloomFilter: decodeBloomFilter(payload['bloomFilter'])
  };
}
export function encodeVfsCrdtReconcileRequestProtobuf(
  request: VfsCrdtReconcileRequest
): Uint8Array {
  return encode(RECONCILE_REQUEST_TYPE, {
    organizationId: request.organizationId
      ? packUuidToBytes(request.organizationId)
      : [],
    clientId: packUuidToBytes(request.clientId),
    cursor: request.cursor,
    lastReconciledWriteIds: request.lastReconciledWriteIds ?? {}
  });
}
export function decodeVfsCrdtReconcileRequestProtobuf(
  bytes: Uint8Array
): unknown {
  const payload = toObject(RECONCILE_REQUEST_TYPE, bytes);
  return {
    organizationId:
      normalizeOptionalBytesString(payload['organizationId']) ?? null,
    clientId: normalizeRequiredBytes(payload['clientId'], 'clientId'),
    cursor: payload['cursor'] as string,
    lastReconciledWriteIds: normalizeWriteIdMap(
      payload['lastReconciledWriteIds']
    )
  };
}
export function encodeVfsCrdtReconcileResponseProtobuf(
  response: VfsCrdtReconcileResponse
): Uint8Array {
  return encode(RECONCILE_RESPONSE_TYPE, {
    clientId: packUuidToBytes(response.clientId),
    cursor: response.cursor,
    lastReconciledWriteIds: response.lastReconciledWriteIds
  });
}
export function decodeVfsCrdtReconcileResponseProtobuf(
  bytes: Uint8Array
): unknown {
  const payload = toObject(RECONCILE_RESPONSE_TYPE, bytes);
  return {
    clientId: normalizeRequiredBytes(payload['clientId'], 'clientId'),
    cursor: payload['cursor'] as string,
    lastReconciledWriteIds: normalizeWriteIdMap(
      payload['lastReconciledWriteIds']
    )
  };
}
export function encodeVfsCrdtSyncSessionRequestProtobuf(
  request: VfsCrdtSyncSessionRequest
): Uint8Array {
  const payload: Record<string, unknown> = {
    organizationId: request.organizationId
      ? packUuidToBytes(request.organizationId)
      : [],
    clientId: packUuidToBytes(request.clientId),
    cursor: request.cursor,
    limit: request.limit,
    operations: request.operations.map((operation) =>
      toOperationPayload(operation)
    ),
    lastReconciledWriteIds: request.lastReconciledWriteIds,
    rootId: request.rootId ? packUuidToBytes(request.rootId) : []
  };
  if (request.bloomFilter) {
    payload['bloomFilter'] = toBloomFilterPayload(request.bloomFilter);
  }
  return encode(SYNC_SESSION_REQUEST_TYPE, payload);
}
export function decodeVfsCrdtSyncSessionRequestProtobuf(
  bytes: Uint8Array
): unknown {
  const payload = toObject(SYNC_SESSION_REQUEST_TYPE, bytes);
  return {
    organizationId:
      normalizeOptionalBytesString(payload['organizationId']) ?? null,
    clientId: normalizeRequiredBytes(payload['clientId'], 'clientId'),
    cursor: payload['cursor'] as string,
    limit: normalizePositiveSafeInteger(payload['limit'], 'limit'),
    operations: Array.isArray(payload['operations'])
      ? payload['operations'].map((operation) => decodePushOperation(operation))
      : [],
    lastReconciledWriteIds: normalizeWriteIdMap(
      payload['lastReconciledWriteIds']
    ),
    rootId: normalizeOptionalBytesString(payload['rootId']) ?? null,
    bloomFilter: decodeBloomFilter(payload['bloomFilter'])
  };
}
export function encodeVfsCrdtSyncSessionResponseProtobuf(
  response: VfsCrdtSyncSessionResponse
): Uint8Array {
  return encode(SYNC_SESSION_RESPONSE_TYPE, {
    push: {
      clientId: packUuidToBytes(response.push.clientId),
      results: response.push.results.map((result) => ({
        opId: packUuidToBytes(result.opId),
        status: toPushStatus(result.status)
      }))
    },
    pull: {
      items: response.pull.items.map((item) => toOperationPayload(item)),
      hasMore: response.pull.hasMore,
      nextCursor: response.pull.nextCursor ?? '',
      lastReconciledWriteIds: response.pull.lastReconciledWriteIds,
      bloomFilter: response.pull.bloomFilter
        ? toBloomFilterPayload(response.pull.bloomFilter)
        : undefined
    },
    reconcile: {
      clientId: packUuidToBytes(response.reconcile.clientId),
      cursor: response.reconcile.cursor,
      lastReconciledWriteIds: response.reconcile.lastReconciledWriteIds
    }
  });
}
export function decodeVfsCrdtSyncSessionResponseProtobuf(
  bytes: Uint8Array
): unknown {
  const payload = toObject(SYNC_SESSION_RESPONSE_TYPE, bytes);
  const push = asRecord(payload['push'], 'push');
  const pull = asRecord(payload['pull'], 'pull');
  const reconcile = asRecord(payload['reconcile'], 'reconcile');
  const pushResults = Array.isArray(push['results']) ? push['results'] : [];
  const pullItems = Array.isArray(pull['items']) ? pull['items'] : [];
  const pullNextCursor = (pull['nextCursor'] as string) || null;
  return {
    push: {
      clientId: normalizeRequiredBytes(push['clientId'], 'push.clientId'),
      results: pushResults.map((entry) => {
        const result = asRecord(entry, 'push.results[]');
        return {
          opId: normalizeRequiredBytes(result['opId'], 'push.results[].opId'),
          status: normalizePushStatus(result['status'])
        };
      })
    },
    pull: {
      items: pullItems.map((entry) => decodeSyncItem(entry)),
      hasMore: pull['hasMore'] === true,
      nextCursor:
        pullNextCursor && pullNextCursor.length > 0 ? pullNextCursor : null,
      lastReconciledWriteIds: normalizeWriteIdMap(
        pull['lastReconciledWriteIds']
      ),
      bloomFilter: decodeBloomFilter(pull['bloomFilter'])
    },
    reconcile: {
      clientId: normalizeRequiredBytes(
        reconcile['clientId'],
        'reconcile.clientId'
      ),
      cursor: reconcile['cursor'] as string,
      lastReconciledWriteIds: normalizeWriteIdMap(
        reconcile['lastReconciledWriteIds']
      )
    }
  };
}
