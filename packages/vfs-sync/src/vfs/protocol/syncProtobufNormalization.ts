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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function asRecord(
  value: unknown,
  fieldName: string
): Record<string, unknown> {
  if (!isRecord(value)) {
    throw new Error(`invalid protobuf payload field: ${fieldName}`);
  }
  return value;
}

export function normalizeRequiredString(value: unknown, fieldName: string): string {
  if (typeof value !== 'string') {
    throw new Error(`invalid protobuf payload field: ${fieldName}`);
  }
  return value;
}

export function normalizeOptionalString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function normalizeOptionalNullableString(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

export function normalizePositiveSafeInteger(
  value: unknown,
  fieldName: string
): number {
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

export function normalizeWriteIdMap(value: unknown): Record<string, unknown> {
  if (!isRecord(value)) {
    return {};
  }

  const output: Record<string, unknown> = {};
  for (const [replicaId, rawWriteId] of Object.entries(value)) {
    const parsedWriteId = normalizeNonNegativeSafeIntegerOrNull(rawWriteId);
    output[replicaId] = parsedWriteId === null ? rawWriteId : parsedWriteId;
  }
  return output;
}

export function toOperationPayload(
  operation: OperationPayloadSource
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

export function decodePushOperation(value: unknown): Record<string, unknown> {
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
    decoded['principalType'] = principalType;
  }
  const principalId = normalizeOptionalString(operation['principalId']);
  if (principalId !== undefined) {
    decoded['principalId'] = principalId;
  }
  const accessLevel = normalizeOptionalString(operation['accessLevel']);
  if (accessLevel !== undefined) {
    decoded['accessLevel'] = accessLevel;
  }
  const parentId = normalizeOptionalString(operation['parentId']);
  if (parentId !== undefined) {
    decoded['parentId'] = parentId;
  }
  const childId = normalizeOptionalString(operation['childId']);
  if (childId !== undefined) {
    decoded['childId'] = childId;
  }
  const encryptedPayload = normalizeOptionalString(operation['encryptedPayload']);
  if (encryptedPayload !== undefined) {
    decoded['encryptedPayload'] = encryptedPayload;
  }
  const keyEpoch = normalizePositiveSafeIntegerOrNull(operation['keyEpoch']);
  if (keyEpoch !== null) {
    decoded['keyEpoch'] = keyEpoch;
  }
  const encryptionNonce = normalizeOptionalString(operation['encryptionNonce']);
  if (encryptionNonce !== undefined) {
    decoded['encryptionNonce'] = encryptionNonce;
  }
  const encryptionAad = normalizeOptionalString(operation['encryptionAad']);
  if (encryptionAad !== undefined) {
    decoded['encryptionAad'] = encryptionAad;
  }
  const encryptionSignature = normalizeOptionalString(
    operation['encryptionSignature']
  );
  if (encryptionSignature !== undefined) {
    decoded['encryptionSignature'] = encryptionSignature;
  }
  return decoded;
}

export function decodeSyncItem(value: unknown): Record<string, unknown> {
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
    decoded['encryptedPayload'] = encryptedPayload;
  }
  const keyEpoch = normalizePositiveSafeIntegerOrNull(operation['keyEpoch']);
  if (keyEpoch !== null) {
    decoded['keyEpoch'] = keyEpoch;
  }
  const encryptionNonce = normalizeOptionalString(operation['encryptionNonce']);
  if (encryptionNonce !== undefined) {
    decoded['encryptionNonce'] = encryptionNonce;
  }
  const encryptionAad = normalizeOptionalString(operation['encryptionAad']);
  if (encryptionAad !== undefined) {
    decoded['encryptionAad'] = encryptionAad;
  }
  const encryptionSignature = normalizeOptionalString(
    operation['encryptionSignature']
  );
  if (encryptionSignature !== undefined) {
    decoded['encryptionSignature'] = encryptionSignature;
  }
  return decoded;
}
