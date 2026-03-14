import type { VfsCrdtSyncItem } from '@tearleads/shared';
import type { VfsCrdtOperation } from '../protocol/sync-crdt.js';
import {
  decodeBase64ToBytes,
  encodeBytesToBase64,
  packUuidToBytes,
  REV_ACCESS_LEVEL_MAP,
  REV_OP_TYPE_MAP,
  REV_PRINCIPAL_TYPE_MAP,
  unpackBytesToUuid
} from '../protocol/syncProtobufNormalization.js';

const VALID_OP_TYPES: VfsCrdtOperation['opType'][] = [
  'acl_add',
  'acl_remove',
  'link_add',
  'link_remove',
  'link_reassign',
  'item_upsert',
  'item_delete'
];
const VALID_PRINCIPAL_TYPES: Array<
  NonNullable<VfsCrdtOperation['principalType']>
> = ['user', 'group', 'organization'];
const VALID_ACCESS_LEVELS: Array<NonNullable<VfsCrdtOperation['accessLevel']>> =
  ['read', 'write', 'admin'];

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
    typeof value !== 'number' ||
    !Number.isFinite(value) ||
    !Number.isInteger(value) ||
    value < 1
  ) {
    throw new Error(`Integration harness failed to parse ${fieldName}`);
  }

  return value;
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
  const occurredAtMs =
    typeof value === 'number'
      ? value
      : typeof value === 'string'
        ? Number(value)
        : NaN;
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

function parseOpType(value: unknown): VfsCrdtOperation['opType'] {
  if (typeof value === 'number' || typeof value === 'string') {
    const decoded = REV_OP_TYPE_MAP[Number(value)];
    if (typeof decoded === 'string') {
      for (const candidate of VALID_OP_TYPES) {
        if (candidate === decoded) {
          return candidate;
        }
      }
    }
  }

  throw new Error('Integration harness failed to parse opType');
}

function parsePrincipalType(
  value: unknown
): VfsCrdtOperation['principalType'] | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }

  if (typeof value === 'number' || typeof value === 'string') {
    const decoded = REV_PRINCIPAL_TYPE_MAP[Number(value)];
    if (typeof decoded === 'string') {
      for (const candidate of VALID_PRINCIPAL_TYPES) {
        if (candidate === decoded) {
          return candidate;
        }
      }
    }
  }

  throw new Error('Integration harness failed to parse principalType');
}

function parseAccessLevel(
  value: unknown
): VfsCrdtOperation['accessLevel'] | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }

  if (typeof value === 'number' || typeof value === 'string') {
    const decoded = REV_ACCESS_LEVEL_MAP[Number(value)];
    if (typeof decoded === 'string') {
      for (const candidate of VALID_ACCESS_LEVELS) {
        if (candidate === decoded) {
          return candidate;
        }
      }
    }
  }

  throw new Error('Integration harness failed to parse accessLevel');
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
    opType: parseOpType(operation['opType']),
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
    opType: item.opType,
    principalType: item.principalType,
    principalId: item.principalId
      ? encodeCompactIdentifier(item.principalId)
      : null,
    accessLevel: item.accessLevel,
    parentId: item.parentId ? encodeCompactIdentifier(item.parentId) : null,
    childId: item.childId ? encodeCompactIdentifier(item.childId) : null,
    actorId: item.actorId ? encodeCompactIdentifier(item.actorId) : null,
    sourceTable: item.sourceTable,
    sourceId: encodeCompactIdentifier(item.sourceId),
    occurredAtMs: toOccurredAtMs(item.occurredAt, 'occurredAt')
  };

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
