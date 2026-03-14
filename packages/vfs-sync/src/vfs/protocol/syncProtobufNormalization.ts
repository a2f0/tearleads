import {
  normalizeOptionalBytes,
  packUuidToBytes,
  readEnvelopeField,
  unpackBytesToUuid,
  writeEnvelopeField
} from './syncProtobufNormalizationBytes.js';
import {
  ACCESS_LEVEL_MAP,
  OP_TYPE_MAP,
  PRINCIPAL_TYPE_MAP,
  PUSH_STATUS_MAP,
  REV_ACCESS_LEVEL_MAP,
  REV_OP_TYPE_MAP,
  REV_PRINCIPAL_TYPE_MAP,
  REV_PUSH_STATUS_MAP
} from './syncProtobufNormalizationEnums.js';
import {
  normalizeNonNegativeSafeIntegerOrNull,
  normalizePositiveSafeInteger,
  normalizePositiveSafeIntegerOrNull
} from './syncProtobufNormalizationNumbers.js';
import {
  asRecord,
  normalizeRequiredString
} from './syncProtobufNormalizationStrings.js';

export * from './syncProtobufNormalizationBytes.js';
export * from './syncProtobufNormalizationEnums.js';
export * from './syncProtobufNormalizationNumbers.js';
export * from './syncProtobufNormalizationStrings.js';

interface OperationPayloadSource {
  opId: string;
  opType: string;
  itemId: string;
  occurredAt: string;
  replicaId?: string;
  writeId?: number;
  principalId?: string | null;
  principalType?: string | null;
  accessLevel?: string | null;
  parentId?: string | null;
  childId?: string | null;
  actorId?: string | null;
  sourceTable?: string;
  sourceId?: string;
  encryptedPayload?: string;
  keyEpoch?: number;
  encryptionNonce?: string;
  encryptionAad?: string;
  encryptionSignature?: string;
  operationSignature?: string;
}

export function normalizeRequiredBytes(
  value: unknown,
  fieldName: string
): string {
  const bytes = normalizeOptionalBytes(value);
  if (!bytes) {
    throw new Error(`invalid protobuf payload field: ${fieldName}`);
  }
  return unpackBytesToUuid(bytes);
}

export function normalizeOptionalBytesString(
  value: unknown
): string | undefined {
  const bytes = normalizeOptionalBytes(value);
  if (!bytes) {
    return undefined;
  }
  return unpackBytesToUuid(bytes);
}

export function toOperationPayload(
  operation: OperationPayloadSource
): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    opId: packUuidToBytes(operation.opId),
    opType: OP_TYPE_MAP[operation.opType] ?? 0,
    itemId: packUuidToBytes(operation.itemId),
    occurredAtMs: Date.parse(operation.occurredAt)
  };
  if (typeof operation.replicaId === 'string') {
    payload['replicaId'] = packUuidToBytes(operation.replicaId);
  }
  if (typeof operation.writeId === 'number') {
    payload['writeId'] = operation.writeId;
  }
  if (typeof operation.principalId === 'string') {
    payload['principalId'] = packUuidToBytes(operation.principalId);
  }
  if (typeof operation.principalType === 'string') {
    payload['principalType'] = PRINCIPAL_TYPE_MAP[operation.principalType] ?? 0;
  }
  if (typeof operation.accessLevel === 'string') {
    payload['accessLevel'] = ACCESS_LEVEL_MAP[operation.accessLevel] ?? 0;
  }
  if (typeof operation.parentId === 'string') {
    payload['parentId'] = packUuidToBytes(operation.parentId);
  }
  if (typeof operation.childId === 'string') {
    payload['childId'] = packUuidToBytes(operation.childId);
  }
  if (typeof operation.actorId === 'string') {
    payload['actorId'] = packUuidToBytes(operation.actorId);
  }
  if (typeof operation.sourceTable === 'string') {
    payload['sourceTable'] = operation.sourceTable;
  }
  if (typeof operation.sourceId === 'string') {
    payload['sourceId'] = packUuidToBytes(operation.sourceId);
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
  if (typeof operation.operationSignature === 'string') {
    payload['operationSignature'] = packUuidToBytes(operation.operationSignature);
  }
  return payload;
}

export function decodePushOperation(value: unknown): Record<string, unknown> {
  const operation = asRecord(value, 'operations[]');
  const occurredAtMs = normalizeNonNegativeSafeIntegerOrNull(
    operation['occurredAtMs']
  );
  const decoded: Record<string, unknown> = {
    opId: normalizeRequiredBytes(operation['opId'], 'opId'),
    opType: REV_OP_TYPE_MAP[Number(operation['opType'])] ?? 'acl_add',
    itemId: normalizeRequiredBytes(operation['itemId'], 'itemId'),
    replicaId: normalizeRequiredBytes(operation['replicaId'], 'replicaId'),
    writeId: normalizePositiveSafeInteger(operation['writeId'], 'writeId'),
    occurredAt:
      occurredAtMs !== null
        ? new Date(occurredAtMs).toISOString()
        : '1970-01-01T00:00:00.000Z'
  };
  const principalType = operation['principalType'];
  if (typeof principalType === 'number' || typeof principalType === 'string') {
    decoded['principalType'] =
      REV_PRINCIPAL_TYPE_MAP[Number(principalType)] ?? 'user';
  }
  const principalId = normalizeOptionalBytesString(operation['principalId']);
  if (principalId !== undefined) {
    decoded['principalId'] = principalId;
  }
  const accessLevel = operation['accessLevel'];
  if (typeof accessLevel === 'number' || typeof accessLevel === 'string') {
    decoded['accessLevel'] =
      REV_ACCESS_LEVEL_MAP[Number(accessLevel)] ?? 'read';
  }
  const parentId = normalizeOptionalBytesString(operation['parentId']);
  if (parentId !== undefined) {
    decoded['parentId'] = parentId;
  }
  const childId = normalizeOptionalBytesString(operation['childId']);
  if (childId !== undefined) {
    decoded['childId'] = childId;
  }
  if (typeof operation['encryptedPayload'] === 'string') {
    decoded['encryptedPayload'] = operation['encryptedPayload'];
  }
  const keyEpoch = normalizePositiveSafeIntegerOrNull(operation['keyEpoch']);
  if (keyEpoch !== null) {
    decoded['keyEpoch'] = keyEpoch;
  }
  if (typeof operation['encryptionNonce'] === 'string') {
    decoded['encryptionNonce'] = operation['encryptionNonce'];
  }
  if (typeof operation['encryptionAad'] === 'string') {
    decoded['encryptionAad'] = operation['encryptionAad'];
  }
  if (typeof operation['encryptionSignature'] === 'string') {
    decoded['encryptionSignature'] = operation['encryptionSignature'];
  }
  const operationSignature = normalizeOptionalBytesString(operation['operationSignature']);
  if (operationSignature !== undefined) {
    decoded['operationSignature'] = operationSignature;
  }
  return decoded;
}

export function decodeSyncItem(value: unknown): Record<string, unknown> {
  const operation = asRecord(value, 'items[]');
  const occurredAtMs = normalizeNonNegativeSafeIntegerOrNull(
    operation['occurredAtMs']
  );
  const decoded: Record<string, unknown> = {
    opId: normalizeRequiredBytes(operation['opId'], 'opId'),
    itemId: normalizeRequiredBytes(operation['itemId'], 'itemId'),
    opType: REV_OP_TYPE_MAP[Number(operation['opType'])] ?? 'acl_add',
    principalType:
      REV_PRINCIPAL_TYPE_MAP[Number(operation['principalType'])] ?? null,
    principalId: normalizeOptionalBytesString(operation['principalId']) ?? null,
    accessLevel: REV_ACCESS_LEVEL_MAP[Number(operation['accessLevel'])] ?? null,
    parentId: normalizeOptionalBytesString(operation['parentId']) ?? null,
    childId: normalizeOptionalBytesString(operation['childId']) ?? null,
    actorId: normalizeOptionalBytesString(operation['actorId']) ?? null,
    sourceTable: normalizeRequiredString(
      operation['sourceTable'],
      'sourceTable'
    ),
    sourceId: normalizeRequiredBytes(operation['sourceId'], 'sourceId'),
    occurredAt:
      occurredAtMs !== null
        ? new Date(occurredAtMs).toISOString()
        : '1970-01-01T00:00:00.000Z'
  };
  if (typeof operation['encryptedPayload'] === 'string') {
    decoded['encryptedPayload'] = operation['encryptedPayload'];
  }
  const keyEpoch = normalizePositiveSafeIntegerOrNull(operation['keyEpoch']);
  if (keyEpoch !== null) {
    decoded['keyEpoch'] = keyEpoch;
  }
  if (typeof operation['encryptionNonce'] === 'string') {
    decoded['encryptionNonce'] = operation['encryptionNonce'];
  }
  if (typeof operation['encryptionAad'] === 'string') {
    decoded['encryptionAad'] = operation['encryptionAad'];
  }
  if (typeof operation['encryptionSignature'] === 'string') {
    decoded['encryptionSignature'] = operation['encryptionSignature'];
  }
  const operationSignature = normalizeOptionalBytesString(operation['operationSignature']);
  if (operationSignature !== undefined) {
    decoded['operationSignature'] = operationSignature;
  }
  return decoded;
}

export function normalizePushStatus(value: unknown): string {
  return REV_PUSH_STATUS_MAP[Number(value)] ?? 'invalidOp';
}

export function toPushStatus(value: string): number {
  return PUSH_STATUS_MAP[value] ?? 0;
}
