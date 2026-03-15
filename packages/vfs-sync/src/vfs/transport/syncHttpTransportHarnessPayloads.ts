import type { VfsCrdtSyncItem } from '@tearleads/shared';
import type { VfsCrdtOperation } from '../protocol/sync-crdt.js';
import {
  decodeBase64ToBytes,
  encodeBytesToBase64,
  packUuidToBytes,
  unpackBytesToUuid
} from '../protocol/syncProtobufNormalization.js';
import {
  encodeConnectJsonAccessLevel,
  encodeConnectJsonOpType,
  encodeConnectJsonPrincipalType,
  parseNullableAccessLevel,
  parseNullablePrincipalType,
  parseOpType
} from './syncHttpTransportEnumParsing.js';

function asRecord(value: unknown, fieldName: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`Integration harness failed to parse ${fieldName}`);
  }

  const record: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) {
    record[key] = entry;
  }
  return record;
}

function parseWriteId(value: unknown, fieldName: string): number {
  if (
    typeof value !== 'string' ||
    !/^[0-9]+$/u.test(value) ||
    !Number.isSafeInteger(Number(value)) ||
    Number(value) < 1
  ) {
    throw new Error(`Integration harness failed to parse ${fieldName}`);
  }

  return Number(value);
}

function parseOptionalString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

export function encodeCompactIdentifier(value: string): string {
  return encodeBytesToBase64(packUuidToBytes(value));
}

function decodeIdentifier(value: unknown, fieldName: string): string {
  if (typeof value !== 'string') {
    throw new Error(`Integration harness failed to parse ${fieldName}`);
  }

  const bytes = decodeBase64ToBytes(value);
  if (!bytes) {
    throw new Error(`Integration harness failed to parse ${fieldName}`);
  }

  return unpackBytesToUuid(bytes);
}

export function decodeCompactClientId(value: unknown): string {
  return decodeIdentifier(value, 'clientId');
}

function parseOccurredAt(value: unknown, fieldName: string): string {
  if (typeof value !== 'string' || !/^[0-9]+$/u.test(value)) {
    throw new Error(`Integration harness failed to parse ${fieldName}`);
  }

  const occurredAtMs = Number(value);
  if (
    !Number.isFinite(occurredAtMs) ||
    !Number.isSafeInteger(occurredAtMs) ||
    occurredAtMs < 0
  ) {
    throw new Error(`Integration harness failed to parse ${fieldName}`);
  }

  return new Date(occurredAtMs).toISOString();
}

function toOccurredAtMs(value: string, fieldName: string): number {
  const occurredAtMs = Date.parse(value);
  if (!Number.isFinite(occurredAtMs)) {
    throw new Error(`Integration harness failed to parse ${fieldName}`);
  }

  return occurredAtMs;
}

function parsePrincipalType(
  value: unknown
): VfsCrdtOperation['principalType'] | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }
  return parseNullablePrincipalType(value, 'principalType') ?? undefined;
}

function parseAccessLevel(
  value: unknown
): VfsCrdtOperation['accessLevel'] | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }
  return parseNullableAccessLevel(value, 'accessLevel') ?? undefined;
}

function parseOptionalIdentifier(
  value: unknown,
  fieldName: string
): string | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }

  return decodeIdentifier(value, fieldName);
}

function parsePushOperation(value: unknown): VfsCrdtOperation {
  const operation = asRecord(value, 'push operation');
  const parsed: VfsCrdtOperation = {
    opId: decodeIdentifier(operation['opId'], 'opId'),
    opType: parseOpType(operation['opType'], 'opType'),
    itemId: decodeIdentifier(operation['itemId'], 'itemId'),
    replicaId: decodeIdentifier(operation['replicaId'], 'replicaId'),
    writeId: parseWriteId(operation['writeId'], 'writeId'),
    occurredAt: parseOccurredAt(operation['occurredAtMs'], 'occurredAtMs')
  };

  const principalType = parsePrincipalType(operation['principalType']);
  if (principalType) {
    parsed.principalType = principalType;
  }
  const principalId = parseOptionalIdentifier(
    operation['principalId'],
    'principalId'
  );
  if (principalId) {
    parsed.principalId = principalId;
  }
  const accessLevel = parseAccessLevel(operation['accessLevel']);
  if (accessLevel) {
    parsed.accessLevel = accessLevel;
  }
  const parentId = parseOptionalIdentifier(operation['parentId'], 'parentId');
  if (parentId) {
    parsed.parentId = parentId;
  }
  const childId = parseOptionalIdentifier(operation['childId'], 'childId');
  if (childId) {
    parsed.childId = childId;
  }
  const encryptedPayload = parseOptionalString(operation['encryptedPayload']);
  if (encryptedPayload) {
    parsed.encryptedPayload = encryptedPayload;
  }
  if (
    typeof operation['keyEpoch'] === 'number' &&
    Number.isFinite(operation['keyEpoch']) &&
    Number.isInteger(operation['keyEpoch']) &&
    operation['keyEpoch'] >= 1
  ) {
    parsed.keyEpoch = operation['keyEpoch'];
  }
  const encryptionNonce = parseOptionalString(operation['encryptionNonce']);
  if (encryptionNonce) {
    parsed.encryptionNonce = encryptionNonce;
  }
  const encryptionAad = parseOptionalString(operation['encryptionAad']);
  if (encryptionAad) {
    parsed.encryptionAad = encryptionAad;
  }
  const encryptionSignature = parseOptionalString(
    operation['encryptionSignature']
  );
  if (encryptionSignature) {
    parsed.encryptionSignature = encryptionSignature;
  }

  return parsed;
}

export function parseCompactPushOperations(value: unknown): VfsCrdtOperation[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.map((entry) => parsePushOperation(entry));
}

export function encodePullItem(item: VfsCrdtSyncItem): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    opId: encodeCompactIdentifier(item.opId),
    itemId: encodeCompactIdentifier(item.itemId),
    opType: encodeConnectJsonOpType(item.opType),
    principalId: item.principalId
      ? encodeCompactIdentifier(item.principalId)
      : null,
    parentId: item.parentId ? encodeCompactIdentifier(item.parentId) : null,
    childId: item.childId ? encodeCompactIdentifier(item.childId) : null,
    actorId: item.actorId ? encodeCompactIdentifier(item.actorId) : null,
    sourceTable: item.sourceTable,
    sourceId: encodeCompactIdentifier(item.sourceId),
    occurredAtMs: String(toOccurredAtMs(item.occurredAt, 'occurredAt'))
  };
  if (item.principalType) {
    payload['principalType'] = encodeConnectJsonPrincipalType(
      item.principalType
    );
  }
  if (item.accessLevel) {
    payload['accessLevel'] = encodeConnectJsonAccessLevel(item.accessLevel);
  }

  if (typeof item.encryptedPayload === 'string') {
    payload['encryptedPayload'] = item.encryptedPayload;
  }
  if (typeof item.keyEpoch === 'number') {
    payload['keyEpoch'] = item.keyEpoch;
  }
  if (typeof item.encryptionNonce === 'string') {
    payload['encryptionNonce'] = item.encryptionNonce;
  }
  if (typeof item.encryptionAad === 'string') {
    payload['encryptionAad'] = item.encryptionAad;
  }
  if (typeof item.encryptionSignature === 'string') {
    payload['encryptionSignature'] = item.encryptionSignature;
  }

  return payload;
}
