import type {
  VfsCrdtPushOperation,
  VfsCrdtPushRequest,
  VfsCrdtPushResponse,
  VfsCrdtReconcileRequest,
  VfsCrdtReconcileResponse,
  VfsCrdtSyncSessionRequest,
  VfsCrdtSyncSessionResponse,
  VfsCrdtSyncItem,
  VfsCrdtSyncResponse
} from '@tearleads/shared';
import type protobuf from 'protobufjs';
import {
  PULL_RESPONSE_TYPE,
  PUSH_REQUEST_TYPE,
  PUSH_RESPONSE_TYPE,
  RECONCILE_REQUEST_TYPE,
  RECONCILE_RESPONSE_TYPE,
  SYNC_SESSION_REQUEST_TYPE,
  SYNC_SESSION_RESPONSE_TYPE
} from './sync-protobuf-schema.js';
function asRecord(
  value: unknown,
  fieldName: string
): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`invalid protobuf payload field: ${fieldName}`);
  }
  return value;
}
function toObject(type: protobuf.Type, bytes: Uint8Array): Record<string, unknown> {
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
function encode(type: protobuf.Type, payload: Record<string, unknown>): Uint8Array {
  const verified = type.verify(payload);
  if (verified) {
    throw new Error(`invalid protobuf payload: ${verified}`);
  }
  return type.encode(type.create(payload)).finish();
}
function normalizeRequiredString(value: unknown, fieldName: string): string {
  if (typeof value !== 'string') {
    throw new Error(`invalid protobuf payload field: ${fieldName}`);
  }
  return value;
}
function normalizeOptionalString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}
function normalizeOptionalNullableString(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}
function normalizePositiveSafeInteger(value: unknown, fieldName: string): number {
  const parsed = normalizePositiveSafeIntegerOrNull(value);
  if (parsed === null) {
    throw new Error(`invalid protobuf payload field: ${fieldName}`);
  }
  return parsed;
}
function normalizePositiveSafeIntegerOrNull(value: unknown): number | null {
  if (typeof value === 'number') {
    if (
      Number.isFinite(value) &&
      Number.isInteger(value) &&
      value >= 1 &&
      value <= Number.MAX_SAFE_INTEGER
    ) {
      return value;
    }
    return null;
  }
  if (typeof value === 'string') {
    if (!/^[0-9]+$/.test(value)) {
      return null;
    }
    const parsed = Number.parseInt(value, 10);
    if (
      Number.isFinite(parsed) &&
      Number.isInteger(parsed) &&
      parsed >= 1 &&
      parsed <= Number.MAX_SAFE_INTEGER
    ) {
      return parsed;
    }
    return null;
  }
  if (
    typeof value === 'object' &&
    value !== null &&
    'toString' in value &&
    typeof value.toString === 'function'
  ) {
    return normalizePositiveSafeIntegerOrNull(value.toString());
  }
  return null;
}
function normalizeNonNegativeSafeIntegerOrNull(value: unknown): number | null {
  if (typeof value === 'number') {
    if (
      Number.isFinite(value) &&
      Number.isInteger(value) &&
      value >= 0 &&
      value <= Number.MAX_SAFE_INTEGER
    ) {
      return value;
    }
    return null;
  }
  if (typeof value === 'string') {
    if (!/^[0-9]+$/.test(value)) {
      return null;
    }
    const parsed = Number.parseInt(value, 10);
    if (
      Number.isFinite(parsed) &&
      Number.isInteger(parsed) &&
      parsed >= 0 &&
      parsed <= Number.MAX_SAFE_INTEGER
    ) {
      return parsed;
    }
    return null;
  }
  if (
    typeof value === 'object' &&
    value !== null &&
    'toString' in value &&
    typeof value.toString === 'function'
  ) {
    return normalizeNonNegativeSafeIntegerOrNull(value.toString());
  }
  return null;
}
function normalizeWriteIdMap(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return {};
  }
  const output: Record<string, unknown> = {};
  for (const [replicaId, rawWriteId] of Object.entries(value)) {
    const parsedWriteId = normalizeNonNegativeSafeIntegerOrNull(rawWriteId);
    if (parsedWriteId === null) {
      output[replicaId] = rawWriteId;
    } else {
      output[replicaId] = parsedWriteId;
    }
  }
  return output;
}
function toOperationPayload(
  operation: Partial<VfsCrdtPushOperation> & Partial<VfsCrdtSyncItem>
): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    opId: operation.opId,
    opType: operation.opType,
    itemId: operation.itemId,
    occurredAt: operation.occurredAt
  };
  if (typeof operation.replicaId === 'string') {
    payload['replicaId'] = operation.replicaId;
  }
  if (typeof operation.writeId === 'number') {
    payload['writeId'] = operation.writeId;
  }
  if (typeof operation.principalId === 'string') {
    payload['principalId'] = operation.principalId;
  }
  if (typeof operation.principalType === 'string') {
    payload['principalType'] = operation.principalType;
  }
  if (typeof operation.accessLevel === 'string') {
    payload['accessLevel'] = operation.accessLevel;
  }
  if (typeof operation.parentId === 'string') {
    payload['parentId'] = operation.parentId;
  }
  if (typeof operation.childId === 'string') {
    payload['childId'] = operation.childId;
  }
  if (typeof operation.actorId === 'string') {
    payload['actorId'] = operation.actorId;
  }
  if (typeof operation.sourceTable === 'string') {
    payload['sourceTable'] = operation.sourceTable;
  }
  if (typeof operation.sourceId === 'string') {
    payload['sourceId'] = operation.sourceId;
  }
  if (typeof operation.encryptedPayload === 'string') {
    payload['encryptedPayload'] = operation.encryptedPayload;
  }
  if (typeof operation.keyEpoch === 'number') {
    payload['keyEpoch'] = operation.keyEpoch;
  }
  if (typeof operation.encryptionNonce === 'string') {
    payload['encryptionNonce'] = operation.encryptionNonce;
  }
  if (typeof operation.encryptionAad === 'string') {
    payload['encryptionAad'] = operation.encryptionAad;
  }
  if (typeof operation.encryptionSignature === 'string') {
    payload['encryptionSignature'] = operation.encryptionSignature;
  }
  return payload;
}
function decodePushOperation(value: unknown): Record<string, unknown> {
  const operation = asRecord(value, 'operations[]');
  const decoded: Record<string, unknown> = {
    opId: normalizeRequiredString(operation['opId'], 'opId'),
    opType: normalizeRequiredString(operation['opType'], 'opType'),
    itemId: normalizeRequiredString(operation['itemId'], 'itemId'),
    replicaId: normalizeRequiredString(operation['replicaId'], 'replicaId'),
    writeId: normalizePositiveSafeInteger(operation['writeId'], 'writeId'),
    occurredAt: normalizeRequiredString(operation['occurredAt'], 'occurredAt')
  };
  const principalType = normalizeOptionalString(operation['principalType']);
  if (principalType !== undefined) {
    decoded.principalType = principalType;
  }
  const principalId = normalizeOptionalString(operation['principalId']);
  if (principalId !== undefined) {
    decoded.principalId = principalId;
  }
  const accessLevel = normalizeOptionalString(operation['accessLevel']);
  if (accessLevel !== undefined) {
    decoded.accessLevel = accessLevel;
  }
  const parentId = normalizeOptionalString(operation['parentId']);
  if (parentId !== undefined) {
    decoded.parentId = parentId;
  }
  const childId = normalizeOptionalString(operation['childId']);
  if (childId !== undefined) {
    decoded.childId = childId;
  }
  const encryptedPayload = normalizeOptionalString(operation['encryptedPayload']);
  if (encryptedPayload !== undefined) {
    decoded.encryptedPayload = encryptedPayload;
  }
  const keyEpoch = normalizePositiveSafeIntegerOrNull(operation['keyEpoch']);
  if (keyEpoch !== null) {
    decoded.keyEpoch = keyEpoch;
  }
  const encryptionNonce = normalizeOptionalString(operation['encryptionNonce']);
  if (encryptionNonce !== undefined) {
    decoded.encryptionNonce = encryptionNonce;
  }
  const encryptionAad = normalizeOptionalString(operation['encryptionAad']);
  if (encryptionAad !== undefined) {
    decoded.encryptionAad = encryptionAad;
  }
  const encryptionSignature = normalizeOptionalString(
    operation['encryptionSignature']
  );
  if (encryptionSignature !== undefined) {
    decoded.encryptionSignature = encryptionSignature;
  }
  return decoded;
}
function decodeSyncItem(value: unknown): Record<string, unknown> {
  const operation = asRecord(value, 'items[]');
  const decoded: Record<string, unknown> = {
    opId: normalizeRequiredString(operation['opId'], 'opId'),
    itemId: normalizeRequiredString(operation['itemId'], 'itemId'),
    opType: normalizeRequiredString(operation['opType'], 'opType'),
    principalType: normalizeOptionalNullableString(operation['principalType']),
    principalId: normalizeOptionalNullableString(operation['principalId']),
    accessLevel: normalizeOptionalNullableString(operation['accessLevel']),
    parentId: normalizeOptionalNullableString(operation['parentId']),
    childId: normalizeOptionalNullableString(operation['childId']),
    actorId: normalizeOptionalNullableString(operation['actorId']),
    sourceTable: normalizeRequiredString(operation['sourceTable'], 'sourceTable'),
    sourceId: normalizeRequiredString(operation['sourceId'], 'sourceId'),
    occurredAt: normalizeRequiredString(operation['occurredAt'], 'occurredAt')
  };
  const encryptedPayload = normalizeOptionalString(operation['encryptedPayload']);
  if (encryptedPayload !== undefined) {
    decoded.encryptedPayload = encryptedPayload;
  }
  const keyEpoch = normalizePositiveSafeIntegerOrNull(operation['keyEpoch']);
  if (keyEpoch !== null) {
    decoded.keyEpoch = keyEpoch;
  }
  const encryptionNonce = normalizeOptionalString(operation['encryptionNonce']);
  if (encryptionNonce !== undefined) {
    decoded.encryptionNonce = encryptionNonce;
  }
  const encryptionAad = normalizeOptionalString(operation['encryptionAad']);
  if (encryptionAad !== undefined) {
    decoded.encryptionAad = encryptionAad;
  }
  const encryptionSignature = normalizeOptionalString(
    operation['encryptionSignature']
  );
  if (encryptionSignature !== undefined) {
    decoded.encryptionSignature = encryptionSignature;
  }
  return decoded;
}
export function encodeVfsCrdtPushRequestProtobuf(
  request: VfsCrdtPushRequest
): Uint8Array {
  return encode(PUSH_REQUEST_TYPE, {
    clientId: request.clientId,
    operations: request.operations.map((operation) => toOperationPayload(operation))
  });
}
export function decodeVfsCrdtPushRequestProtobuf(
  bytes: Uint8Array
): unknown {
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
export function decodeVfsCrdtPushResponseProtobuf(
  bytes: Uint8Array
): unknown {
  const payload = toObject(PUSH_RESPONSE_TYPE, bytes);
  const rawResults = Array.isArray(payload['results']) ? payload['results'] : [];
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
export function decodeVfsCrdtSyncResponseProtobuf(
  bytes: Uint8Array
): unknown {
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
    lastReconciledWriteIds: normalizeWriteIdMap(payload['lastReconciledWriteIds'])
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
    lastReconciledWriteIds: normalizeWriteIdMap(payload['lastReconciledWriteIds'])
  };
}
export function encodeVfsCrdtSyncSessionRequestProtobuf(
  request: VfsCrdtSyncSessionRequest
): Uint8Array {
  return encode(SYNC_SESSION_REQUEST_TYPE, {
    clientId: request.clientId,
    cursor: request.cursor,
    limit: request.limit,
    operations: request.operations.map((operation) => toOperationPayload(operation)),
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
    lastReconciledWriteIds: normalizeWriteIdMap(payload['lastReconciledWriteIds']),
    rootId: normalizeOptionalString(payload['rootId']) ?? null
  };
}
export function encodeVfsCrdtSyncSessionResponseProtobuf(
  response: VfsCrdtSyncSessionResponse
): Uint8Array {
  return encode(SYNC_SESSION_RESPONSE_TYPE, response as Record<string, unknown>);
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
      nextCursor: normalizeOptionalString(pull['nextCursor']) ?? null,
      lastReconciledWriteIds: normalizeWriteIdMap(pull['lastReconciledWriteIds'])
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
