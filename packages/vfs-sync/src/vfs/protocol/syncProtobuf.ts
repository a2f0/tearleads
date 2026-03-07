import type {
  VfsCrdtPushRequest,
  VfsCrdtPushResponse,
  VfsCrdtReconcileRequest,
  VfsCrdtReconcileResponse,
  VfsCrdtSyncResponse,
  VfsCrdtSyncSessionRequest,
  VfsCrdtSyncSessionResponse
} from '@tearleads/shared';
import type protobuf from 'protobufjs';
import {
  asRecord,
  decodePushOperation,
  decodeSyncItem,
  normalizeOptionalString,
  normalizePositiveSafeInteger,
  normalizeRequiredString,
  normalizeWriteIdMap,
  toOperationPayload
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
      objects: true
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

export function encodeVfsCrdtPushRequestProtobuf(
  request: VfsCrdtPushRequest
): Uint8Array {
  return encode(PUSH_REQUEST_TYPE, {
    clientId: request.clientId,
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
    clientId: normalizeRequiredString(payload['clientId'], 'clientId'),
    operations
  };
}
export function encodeVfsCrdtPushResponseProtobuf(
  response: VfsCrdtPushResponse
): Uint8Array {
  return encode(PUSH_RESPONSE_TYPE, {
    clientId: response.clientId,
    results: response.results.map((result) => ({
      opId: result.opId,
      status: result.status
    }))
  });
}
export function decodeVfsCrdtPushResponseProtobuf(bytes: Uint8Array): unknown {
  const payload = toObject(PUSH_RESPONSE_TYPE, bytes);
  const rawResults = Array.isArray(payload['results'])
    ? payload['results']
    : [];
  return {
    clientId: normalizeRequiredString(payload['clientId'], 'clientId'),
    results: rawResults.map((entry) => {
      const result = asRecord(entry, 'results[]');
      return {
        opId: normalizeRequiredString(result['opId'], 'results[].opId'),
        status: normalizeRequiredString(result['status'], 'results[].status')
      };
    })
  };
}
export function encodeVfsCrdtSyncResponseProtobuf(
  response: VfsCrdtSyncResponse
): Uint8Array {
  return encode(PULL_RESPONSE_TYPE, {
    items: response.items.map((item) => toOperationPayload(item)),
    hasMore: response.hasMore,
    nextCursor: response.nextCursor ?? '',
    lastReconciledWriteIds: response.lastReconciledWriteIds
  });
}
export function decodeVfsCrdtSyncResponseProtobuf(bytes: Uint8Array): unknown {
  const payload = toObject(PULL_RESPONSE_TYPE, bytes);
  const rawItems = Array.isArray(payload['items']) ? payload['items'] : [];
  const nextCursor = normalizeOptionalString(payload['nextCursor']) ?? null;
  const hasMore = payload['hasMore'] === true;
  return {
    items: rawItems.map((entry) => decodeSyncItem(entry)),
    hasMore,
    nextCursor: nextCursor && nextCursor.length > 0 ? nextCursor : null,
    lastReconciledWriteIds: normalizeWriteIdMap(
      payload['lastReconciledWriteIds']
    )
  };
}
export function encodeVfsCrdtReconcileRequestProtobuf(
  request: VfsCrdtReconcileRequest
): Uint8Array {
  return encode(RECONCILE_REQUEST_TYPE, {
    clientId: request.clientId,
    cursor: request.cursor,
    lastReconciledWriteIds: request.lastReconciledWriteIds ?? {}
  });
}
export function decodeVfsCrdtReconcileRequestProtobuf(
  bytes: Uint8Array
): unknown {
  const payload = toObject(RECONCILE_REQUEST_TYPE, bytes);
  return {
    clientId: normalizeRequiredString(payload['clientId'], 'clientId'),
    cursor: normalizeRequiredString(payload['cursor'], 'cursor'),
    lastReconciledWriteIds: normalizeWriteIdMap(
      payload['lastReconciledWriteIds']
    )
  };
}
export function encodeVfsCrdtReconcileResponseProtobuf(
  response: VfsCrdtReconcileResponse
): Uint8Array {
  return encode(RECONCILE_RESPONSE_TYPE, {
    clientId: response.clientId,
    cursor: response.cursor,
    lastReconciledWriteIds: response.lastReconciledWriteIds
  });
}
export function decodeVfsCrdtReconcileResponseProtobuf(
  bytes: Uint8Array
): unknown {
  const payload = toObject(RECONCILE_RESPONSE_TYPE, bytes);
  return {
    clientId: normalizeRequiredString(payload['clientId'], 'clientId'),
    cursor: normalizeRequiredString(payload['cursor'], 'cursor'),
    lastReconciledWriteIds: normalizeWriteIdMap(
      payload['lastReconciledWriteIds']
    )
  };
}
export function encodeVfsCrdtSyncSessionRequestProtobuf(
  request: VfsCrdtSyncSessionRequest
): Uint8Array {
  return encode(SYNC_SESSION_REQUEST_TYPE, {
    clientId: request.clientId,
    cursor: request.cursor,
    limit: request.limit,
    operations: request.operations.map((operation) =>
      toOperationPayload(operation)
    ),
    lastReconciledWriteIds: request.lastReconciledWriteIds ?? {},
    rootId: request.rootId ?? ''
  });
}
export function decodeVfsCrdtSyncSessionRequestProtobuf(
  bytes: Uint8Array
): unknown {
  const payload = toObject(SYNC_SESSION_REQUEST_TYPE, bytes);
  return {
    clientId: normalizeRequiredString(payload['clientId'], 'clientId'),
    cursor: normalizeRequiredString(payload['cursor'], 'cursor'),
    limit: normalizePositiveSafeInteger(payload['limit'], 'limit'),
    operations: Array.isArray(payload['operations'])
      ? payload['operations'].map((operation) => decodePushOperation(operation))
      : [],
    lastReconciledWriteIds: normalizeWriteIdMap(
      payload['lastReconciledWriteIds']
    ),
    rootId: normalizeOptionalString(payload['rootId']) ?? null
  };
}
export function encodeVfsCrdtSyncSessionResponseProtobuf(
  response: VfsCrdtSyncSessionResponse
): Uint8Array {
  return encode(SYNC_SESSION_RESPONSE_TYPE, {
    push: {
      clientId: response.push.clientId,
      results: response.push.results.map((result) => ({
        opId: result.opId,
        status: result.status
      }))
    },
    pull: {
      items: response.pull.items.map((item) => toOperationPayload(item)),
      hasMore: response.pull.hasMore,
      nextCursor: response.pull.nextCursor ?? '',
      lastReconciledWriteIds: response.pull.lastReconciledWriteIds
    },
    reconcile: {
      clientId: response.reconcile.clientId,
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
  const pullNextCursor = normalizeOptionalString(pull['nextCursor']) ?? null;
  return {
    push: {
      clientId: normalizeRequiredString(push['clientId'], 'push.clientId'),
      results: pushResults.map((entry) => {
        const result = asRecord(entry, 'push.results[]');
        return {
          opId: normalizeRequiredString(result['opId'], 'push.results[].opId'),
          status: normalizeRequiredString(
            result['status'],
            'push.results[].status'
          )
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
      )
    },
    reconcile: {
      clientId: normalizeRequiredString(
        reconcile['clientId'],
        'reconcile.clientId'
      ),
      cursor: normalizeRequiredString(reconcile['cursor'], 'reconcile.cursor'),
      lastReconciledWriteIds: normalizeWriteIdMap(
        reconcile['lastReconciledWriteIds']
      )
    }
  };
}
