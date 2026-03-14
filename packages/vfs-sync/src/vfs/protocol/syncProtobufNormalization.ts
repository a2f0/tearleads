import {
  normalizeOptionalBytes,
  packUuidToBytes,
  unpackBytesToUuid
} from './syncProtobufNormalizationBytes.js';
import {
  ACCESS_LEVEL_MAP,
  OP_TYPE_MAP,
  PRINCIPAL_TYPE_MAP,
  PROTOBUF_ACCESS_LEVEL_MAP,
  PROTOBUF_OP_TYPE_MAP,
  PROTOBUF_PRINCIPAL_TYPE_MAP,
  PROTOBUF_PUSH_STATUS_MAP,
  PUSH_STATUS_MAP
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
  encryptedPayload?: string | null;
  keyEpoch?: number | null;
  encryptionNonce?: string | null;
  encryptionAad?: string | null;
  encryptionSignature?: string | null;
  operationSignature?: string | null;
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

function normalizeRequiredEnumValue(
  value: string,
  fieldName: string,
  enumMap: Record<string, number>
): number {
  const normalized = enumMap[value];
  if (typeof normalized !== 'number') {
    throw new Error(`invalid protobuf payload field: ${fieldName}`);
  }
  return normalized;
}

function normalizeRequiredOccurredAt(
  value: unknown,
  fieldName: string
): string {
  const occurredAtMs = normalizeNonNegativeSafeIntegerOrNull(value);
  if (occurredAtMs === null) {
    throw new Error(`invalid protobuf payload field: ${fieldName}`);
  }
  return new Date(occurredAtMs).toISOString();
}

function normalizeDecodedEnum(
  value: unknown,
  fieldName: string,
  protobufNameMap: Record<string, string>
): string {
  if (typeof value === 'string') {
    const normalized = protobufNameMap[value];
    if (typeof normalized === 'string') {
      return normalized;
    }
  }

  throw new Error(`invalid protobuf payload field: ${fieldName}`);
}

function normalizeOptionalDecodedEnum(
  value: unknown,
  fieldName: string,
  protobufNameMap: Record<string, string>
): string | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }
  return normalizeDecodedEnum(value, fieldName, protobufNameMap);
}

export function toOperationPayload(
  operation: OperationPayloadSource
): Record<string, unknown> {
  const occurredAtMs = Date.parse(operation.occurredAt);
  if (
    !Number.isFinite(occurredAtMs) ||
    !Number.isSafeInteger(occurredAtMs) ||
    occurredAtMs < 0
  ) {
    throw new Error('invalid protobuf payload field: occurredAt');
  }

  const payload: Record<string, unknown> = {
    opId: packUuidToBytes(operation.opId),
    opType: normalizeRequiredEnumValue(operation.opType, 'opType', OP_TYPE_MAP),
    itemId: packUuidToBytes(operation.itemId),
    occurredAtMs
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
    payload['principalType'] = normalizeRequiredEnumValue(
      operation.principalType,
      'principalType',
      PRINCIPAL_TYPE_MAP
    );
  }
  if (typeof operation.accessLevel === 'string') {
    payload['accessLevel'] = normalizeRequiredEnumValue(
      operation.accessLevel,
      'accessLevel',
      ACCESS_LEVEL_MAP
    );
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
    payload['operationSignature'] = packUuidToBytes(
      operation.operationSignature
    );
  }
  return payload;
}

export function decodePushOperation(value: unknown): Record<string, unknown> {
  const operation = asRecord(value, 'operations[]');
  const decoded: Record<string, unknown> = {
    opId: normalizeRequiredBytes(operation['opId'], 'opId'),
    opType: normalizeDecodedEnum(
      operation['opType'],
      'opType',
      PROTOBUF_OP_TYPE_MAP
    ),
    itemId: normalizeRequiredBytes(operation['itemId'], 'itemId'),
    replicaId: normalizeRequiredBytes(operation['replicaId'], 'replicaId'),
    writeId: normalizePositiveSafeInteger(operation['writeId'], 'writeId'),
    occurredAt: normalizeRequiredOccurredAt(
      operation['occurredAtMs'],
      'occurredAtMs'
    )
  };
  const principalType = normalizeOptionalDecodedEnum(
    operation['principalType'],
    'principalType',
    PROTOBUF_PRINCIPAL_TYPE_MAP
  );
  if (principalType !== undefined) {
    decoded['principalType'] = principalType;
  }
  const principalId = normalizeOptionalBytesString(operation['principalId']);
  if (principalId !== undefined) {
    decoded['principalId'] = principalId;
  }
  const accessLevel = normalizeOptionalDecodedEnum(
    operation['accessLevel'],
    'accessLevel',
    PROTOBUF_ACCESS_LEVEL_MAP
  );
  if (accessLevel !== undefined) {
    decoded['accessLevel'] = accessLevel;
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
  const operationSignature = normalizeOptionalBytesString(
    operation['operationSignature']
  );
  if (operationSignature !== undefined) {
    decoded['operationSignature'] = operationSignature;
  }
  return decoded;
}

export function decodeSyncItem(value: unknown): Record<string, unknown> {
  const operation = asRecord(value, 'items[]');
  const principalType = normalizeOptionalDecodedEnum(
    operation['principalType'],
    'principalType',
    PROTOBUF_PRINCIPAL_TYPE_MAP
  );
  const accessLevel = normalizeOptionalDecodedEnum(
    operation['accessLevel'],
    'accessLevel',
    PROTOBUF_ACCESS_LEVEL_MAP
  );
  const decoded: Record<string, unknown> = {
    opId: normalizeRequiredBytes(operation['opId'], 'opId'),
    itemId: normalizeRequiredBytes(operation['itemId'], 'itemId'),
    opType: normalizeDecodedEnum(
      operation['opType'],
      'opType',
      PROTOBUF_OP_TYPE_MAP
    ),
    principalType: principalType ?? null,
    principalId: normalizeOptionalBytesString(operation['principalId']) ?? null,
    accessLevel: accessLevel ?? null,
    parentId: normalizeOptionalBytesString(operation['parentId']) ?? null,
    childId: normalizeOptionalBytesString(operation['childId']) ?? null,
    actorId: normalizeOptionalBytesString(operation['actorId']) ?? null,
    sourceTable: normalizeRequiredString(
      operation['sourceTable'],
      'sourceTable'
    ),
    sourceId: normalizeRequiredBytes(operation['sourceId'], 'sourceId'),
    occurredAt: normalizeRequiredOccurredAt(
      operation['occurredAtMs'],
      'occurredAtMs'
    )
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
  const operationSignature = normalizeOptionalBytesString(
    operation['operationSignature']
  );
  if (operationSignature !== undefined) {
    decoded['operationSignature'] = operationSignature;
  }
  return decoded;
}

export function normalizePushStatus(value: unknown): string {
  return normalizeDecodedEnum(value, 'status', PROTOBUF_PUSH_STATUS_MAP);
}

export function toPushStatus(value: string): number {
  return normalizeRequiredEnumValue(value, 'status', PUSH_STATUS_MAP);
}
