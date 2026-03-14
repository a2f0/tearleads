import type { VfsCrdtOperation } from '../protocol/sync-crdt.js';
import {
  encodeBytesToBase64,
  packUuidToBytes
} from '../protocol/syncProtobufNormalization.js';
import {
  encodeConnectJsonAccessLevel,
  encodeConnectJsonOpType,
  encodeConnectJsonPrincipalType
} from './syncHttpTransportEnumParsing.js';

export function toPackedIdBase64(value: string): string {
  return encodeBytesToBase64(packUuidToBytes(value));
}

function toConnectJsonUint64(
  value: number,
  fieldName: string,
  minimum: number
): string {
  if (
    !Number.isFinite(value) ||
    !Number.isInteger(value) ||
    value < minimum ||
    value > Number.MAX_SAFE_INTEGER
  ) {
    throw new Error(`operation ${fieldName} must be a safe integer`);
  }

  return String(value);
}

function toConnectJsonMapUint64(
  value: number,
  fieldName: string,
  minimum: number
): number {
  if (
    !Number.isFinite(value) ||
    !Number.isInteger(value) ||
    value < minimum ||
    value > Number.MAX_SAFE_INTEGER
  ) {
    throw new Error(`operation ${fieldName} must be a safe integer`);
  }

  return value;
}

export function encodeWriteIdRecord(
  value: Record<string, number>
): Record<string, number> {
  const encoded: Record<string, number> = {};
  for (const [replicaId, writeId] of Object.entries(value)) {
    encoded[replicaId] = toConnectJsonMapUint64(
      writeId,
      'lastReconciledWriteIds',
      1
    );
  }
  return encoded;
}

export function toCompactOperation(
  operation: VfsCrdtOperation
): Record<string, unknown> {
  const occurredAtMs = Date.parse(operation.occurredAt);
  if (!Number.isFinite(occurredAtMs)) {
    throw new Error('operation occurredAt must be a valid ISO timestamp');
  }

  const { occurredAt: _occurredAt, ...rest } = operation;
  const compact: Record<string, unknown> = {
    ...rest,
    opId: toPackedIdBase64(operation.opId),
    opType: encodeConnectJsonOpType(operation.opType),
    itemId: toPackedIdBase64(operation.itemId),
    replicaId: toPackedIdBase64(operation.replicaId),
    writeId: toConnectJsonUint64(operation.writeId, 'writeId', 1),
    occurredAtMs: toConnectJsonUint64(occurredAtMs, 'occurredAt', 0)
  };

  if (operation.principalType) {
    compact['principalType'] = encodeConnectJsonPrincipalType(
      operation.principalType
    );
  }
  if (operation.principalId) {
    compact['principalId'] = toPackedIdBase64(operation.principalId);
  }
  if (operation.accessLevel) {
    compact['accessLevel'] = encodeConnectJsonAccessLevel(
      operation.accessLevel
    );
  }
  if (operation.parentId) {
    compact['parentId'] = toPackedIdBase64(operation.parentId);
  }
  if (operation.childId) {
    compact['childId'] = toPackedIdBase64(operation.childId);
  }

  return compact;
}
