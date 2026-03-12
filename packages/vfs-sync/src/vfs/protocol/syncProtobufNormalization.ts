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
  readEnvelopeField,
  writeEnvelopeField
} from './syncProtobufNormalizationBytes.js';
import {
  normalizeNonNegativeSafeIntegerOrNull,
  normalizePositiveSafeInteger,
  normalizePositiveSafeIntegerOrNull
} from './syncProtobufNormalizationNumbers.js';
import {
  asRecord,
  normalizeOptionalNullableString,
  normalizeOptionalString,
  normalizeRequiredString
} from './syncProtobufNormalizationStrings.js';

export * from './syncProtobufNormalizationEnums.js';
export * from './syncProtobufNormalizationStrings.js';
export * from './syncProtobufNormalizationNumbers.js';
export * from './syncProtobufNormalizationBytes.js';

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
}

export function toOperationPayload(
  operation: OperationPayloadSource
): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    opId: operation.opId,
    opType: OP_TYPE_MAP[operation.opType] ?? 0,
    itemId: operation.itemId,
    occurredAtMs: Date.parse(operation.occurredAt)
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
    payload['principalType'] = PRINCIPAL_TYPE_MAP[operation.principalType] ?? 0;
  }
  if (typeof operation.accessLevel === 'string') {
    payload['accessLevel'] = ACCESS_LEVEL_MAP[operation.accessLevel] ?? 0;
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
    writeEnvelopeField(payload, {
      bytesKey: 'encryptedPayloadBytes',
      value: operation.encryptedPayload,
      fieldName: 'encryptedPayload'
    });
  }
  if (typeof operation.keyEpoch === 'number') {
    payload['keyEpoch'] = operation.keyEpoch;
  }
  if (typeof operation.encryptionNonce === 'string') {
    writeEnvelopeField(payload, {
      bytesKey: 'encryptionNonceBytes',
      value: operation.encryptionNonce,
      fieldName: 'encryptionNonce'
    });
  }
  if (typeof operation.encryptionAad === 'string') {
    writeEnvelopeField(payload, {
      bytesKey: 'encryptionAadBytes',
      value: operation.encryptionAad,
      fieldName: 'encryptionAad'
    });
  }
  if (typeof operation.encryptionSignature === 'string') {
    writeEnvelopeField(payload, {
      bytesKey: 'encryptionSignatureBytes',
      value: operation.encryptionSignature,
      fieldName: 'encryptionSignature'
    });
  }
  return payload;
}

export function decodePushOperation(value: unknown): Record<string, unknown> {
  const operation = asRecord(value, 'operations[]');
  const occurredAtMs = normalizeNonNegativeSafeIntegerOrNull(
    operation['occurredAtMs']
  );
  const decoded: Record<string, unknown> = {
    opId: normalizeRequiredString(operation['opId'], 'opId'),
    opType: REV_OP_TYPE_MAP[Number(operation['opType'])] ?? 'acl_add',
    itemId: normalizeRequiredString(operation['itemId'], 'itemId'),
    replicaId: normalizeRequiredString(operation['replicaId'], 'replicaId'),
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
  const principalId = normalizeOptionalString(operation['principalId']);
  if (principalId !== undefined) {
    decoded['principalId'] = principalId;
  }
  const accessLevel = operation['accessLevel'];
  if (typeof accessLevel === 'number' || typeof accessLevel === 'string') {
    decoded['accessLevel'] = REV_ACCESS_LEVEL_MAP[Number(accessLevel)] ?? 'read';
  }
  const parentId = normalizeOptionalString(operation['parentId']);
  if (parentId !== undefined) {
    decoded['parentId'] = parentId;
  }
  const childId = normalizeOptionalString(operation['childId']);
  if (childId !== undefined) {
    decoded['childId'] = childId;
  }
  const encryptedPayload = readEnvelopeField(
    operation['encryptedPayloadBytes']
  );
  if (encryptedPayload !== undefined) {
    decoded['encryptedPayload'] = encryptedPayload;
  }
  const keyEpoch = normalizePositiveSafeIntegerOrNull(operation['keyEpoch']);
  if (keyEpoch !== null) {
    decoded['keyEpoch'] = keyEpoch;
  }
  const encryptionNonce = readEnvelopeField(operation['encryptionNonceBytes']);
  if (encryptionNonce !== undefined) {
    decoded['encryptionNonce'] = encryptionNonce;
  }
  const encryptionAad = readEnvelopeField(operation['encryptionAadBytes']);
  if (encryptionAad !== undefined) {
    decoded['encryptionAad'] = encryptionAad;
  }
  const encryptionSignature = readEnvelopeField(
    operation['encryptionSignatureBytes']
  );
  if (encryptionSignature !== undefined) {
    decoded['encryptionSignature'] = encryptionSignature;
  }
  return decoded;
}

export function decodeSyncItem(value: unknown): Record<string, unknown> {
  const operation = asRecord(value, 'items[]');
  const occurredAtMs = normalizeNonNegativeSafeIntegerOrNull(
    operation['occurredAtMs']
  );
  const decoded: Record<string, unknown> = {
    opId: normalizeRequiredString(operation['opId'], 'opId'),
    itemId: normalizeRequiredString(operation['itemId'], 'itemId'),
    opType: REV_OP_TYPE_MAP[Number(operation['opType'])] ?? 'acl_add',
    principalType:
      REV_PRINCIPAL_TYPE_MAP[Number(operation['principalType'])] ?? null,
    principalId: normalizeOptionalNullableString(operation['principalId']),
    accessLevel:
      REV_ACCESS_LEVEL_MAP[Number(operation['accessLevel'])] ?? null,
    parentId: normalizeOptionalNullableString(operation['parentId']),
    childId: normalizeOptionalNullableString(operation['childId']),
    actorId: normalizeOptionalNullableString(operation['actorId']),
    sourceTable: normalizeRequiredString(
      operation['sourceTable'],
      'sourceTable'
    ),
    sourceId: normalizeRequiredString(operation['sourceId'], 'sourceId'),
    occurredAt:
      occurredAtMs !== null
        ? new Date(occurredAtMs).toISOString()
        : '1970-01-01T00:00:00.000Z'
  };
  const encryptedPayload = readEnvelopeField(
    operation['encryptedPayloadBytes']
  );
  if (encryptedPayload !== undefined) {
    decoded['encryptedPayload'] = encryptedPayload;
  }
  const keyEpoch = normalizePositiveSafeIntegerOrNull(operation['keyEpoch']);
  if (keyEpoch !== null) {
    decoded['keyEpoch'] = keyEpoch;
  }
  const encryptionNonce = readEnvelopeField(operation['encryptionNonceBytes']);
  if (encryptionNonce !== undefined) {
    decoded['encryptionNonce'] = encryptionNonce;
  }
  const encryptionAad = readEnvelopeField(operation['encryptionAadBytes']);
  if (encryptionAad !== undefined) {
    decoded['encryptionAad'] = encryptionAad;
  }
  const encryptionSignature = readEnvelopeField(
    operation['encryptionSignatureBytes']
  );
  if (encryptionSignature !== undefined) {
    decoded['encryptionSignature'] = encryptionSignature;
  }
  return decoded;
}

export function normalizePushStatus(value: unknown): string {
  return REV_PUSH_STATUS_MAP[Number(value)] ?? 'invalidOp';
}

export function toPushStatus(value: string): number {
  return PUSH_STATUS_MAP[value] ?? 0;
}
