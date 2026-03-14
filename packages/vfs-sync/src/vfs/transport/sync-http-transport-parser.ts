import type {
  VfsAclAccessLevel,
  VfsAclPrincipalType,
  VfsCrdtOpType,
  VfsCrdtPushResponse,
  VfsCrdtPushStatus,
  VfsCrdtReconcileResponse,
  VfsCrdtSyncItem,
  VfsCrdtSyncResponse,
  VfsSyncBloomFilter
} from '@tearleads/shared';
import { parseVfsCrdtLastReconciledWriteIds } from '../protocol/sync-crdt-reconcile.js';
import { decodeVfsSyncCursor } from '../protocol/sync-cursor.js';
import {
  decodeBase64ToBytes,
  unpackBytesToUuid
} from '../protocol/syncProtobufNormalization.js';

export { parseApiErrorResponse } from './syncHttpTransportApiError.js';

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;
const OPAQUE_IDENTIFIER_PATTERN = /^[a-z0-9:-]+$/u;
const VALID_OP_TYPES: VfsCrdtOpType[] = [
  'acl_add',
  'acl_remove',
  'link_add',
  'link_remove',
  'link_reassign',
  'item_upsert',
  'item_delete'
];
const VALID_PRINCIPAL_TYPES: VfsAclPrincipalType[] = [
  'user',
  'group',
  'organization'
];
const VALID_ACCESS_LEVELS: VfsAclAccessLevel[] = ['read', 'write', 'admin'];
const VALID_PUSH_STATUSES: VfsCrdtPushStatus[] = [
  'applied',
  'alreadyApplied',
  'staleWriteId',
  'outdatedOp',
  'invalidOp',
  'aclDenied',
  'encryptedEnvelopeUnsupported'
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseRequiredString(value: unknown, fieldName: string): string {
  if (typeof value !== 'string') {
    throw new Error(`transport returned invalid ${fieldName}`);
  }

  const trimmed = value.trim();
  if (trimmed.length === 0) {
    throw new Error(`transport returned invalid ${fieldName}`);
  }

  return trimmed;
}

function isOpaqueIdentifier(value: string): boolean {
  return OPAQUE_IDENTIFIER_PATTERN.test(value);
}

function decodeIdentifier(value: string): string | null {
  const bytes = decodeBase64ToBytes(value);
  if (!bytes) {
    return null;
  }

  if (bytes.length === 16) {
    return unpackBytesToUuid(bytes);
  }

  const decoded = new TextDecoder().decode(bytes);
  if (decoded.length === 0) {
    return null;
  }

  return UUID_PATTERN.test(decoded) || isOpaqueIdentifier(decoded)
    ? decoded
    : null;
}

function parseIdentifier(value: unknown, fieldName: string): string {
  if (typeof value !== 'string') {
    throw new Error(`transport returned invalid ${fieldName}`);
  }
  const trimmed = value.trim();
  if (!trimmed) {
    throw new Error(`transport returned invalid ${fieldName}`);
  }

  if (UUID_PATTERN.test(trimmed) || isOpaqueIdentifier(trimmed)) {
    return trimmed;
  }

  return decodeIdentifier(trimmed) ?? trimmed;
}

function parseOptionalIdentifier(
  value: unknown,
  fieldName: string
): string | null {
  if (
    value === undefined ||
    value === null ||
    (typeof value === 'string' && value.trim().length === 0)
  ) {
    return null;
  }
  return parseIdentifier(value, fieldName);
}

function parseNullableString(value: unknown, fieldName: string): string | null {
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value === 'string' && value.trim().length === 0) {
    return null;
  }

  return parseRequiredString(value, fieldName);
}

function parseOptionalNullableString(
  value: unknown,
  fieldName: string
): string | null | undefined {
  if (value === undefined) {
    return undefined;
  }
  return parseNullableString(value, fieldName);
}

function isOpType(value: unknown): value is VfsCrdtOpType {
  return (
    typeof value === 'string' &&
    VALID_OP_TYPES.some((candidate) => candidate === value)
  );
}

function parseOpType(value: unknown, fieldName: string): VfsCrdtOpType {
  if (!isOpType(value)) {
    throw new Error(`transport returned invalid ${fieldName}`);
  }

  return value;
}

function isPrincipalType(value: unknown): value is VfsAclPrincipalType {
  return (
    typeof value === 'string' &&
    VALID_PRINCIPAL_TYPES.some((candidate) => candidate === value)
  );
}

function parseNullablePrincipalType(
  value: unknown,
  fieldName: string
): VfsAclPrincipalType | null {
  if (
    value === null ||
    value === undefined ||
    (typeof value === 'string' && value.trim().length === 0)
  ) {
    return null;
  }

  if (!isPrincipalType(value)) {
    throw new Error(`transport returned invalid ${fieldName}`);
  }

  return value;
}

function isAccessLevel(value: unknown): value is VfsAclAccessLevel {
  return (
    typeof value === 'string' &&
    VALID_ACCESS_LEVELS.some((candidate) => candidate === value)
  );
}

function parseNullableAccessLevel(
  value: unknown,
  fieldName: string
): VfsAclAccessLevel | null {
  if (
    value === null ||
    value === undefined ||
    (typeof value === 'string' && value.trim().length === 0)
  ) {
    return null;
  }

  if (!isAccessLevel(value)) {
    throw new Error(`transport returned invalid ${fieldName}`);
  }

  return value;
}

function isPushStatus(value: unknown): value is VfsCrdtPushStatus {
  return (
    typeof value === 'string' &&
    VALID_PUSH_STATUSES.some((candidate) => candidate === value)
  );
}

function parseOccurredAtMs(value: unknown, fieldName: string): string {
  const parsed =
    typeof value === 'number'
      ? value
      : typeof value === 'string'
        ? Number(value)
        : NaN;
  if (!Number.isFinite(parsed) || !Number.isSafeInteger(parsed) || parsed < 0) {
    throw new Error(`transport returned invalid ${fieldName}`);
  }

  return new Date(parsed).toISOString();
}

function parseBloomFilter(value: unknown): VfsSyncBloomFilter | null {
  if (!value || !isRecord(value)) {
    return null;
  }

  return {
    data: parseRequiredString(value['data'], 'bloomFilter.data'),
    capacity: Number(value['capacity']),
    errorRate: Number(value['errorRate'])
  };
}

export function parseApiPushResponse(body: unknown): VfsCrdtPushResponse {
  if (!isRecord(body)) {
    throw new Error('transport returned invalid push response payload');
  }

  const clientId = parseIdentifier(body['clientId'], 'clientId');
  const rawResults = body['results'];
  if (!Array.isArray(rawResults)) {
    throw new Error('transport returned invalid push response results');
  }

  const results: VfsCrdtPushResponse['results'] = [];
  for (let index = 0; index < rawResults.length; index++) {
    const rawResult = rawResults[index];
    if (!isRecord(rawResult)) {
      throw new Error(
        `transport returned invalid push result at index ${index}`
      );
    }

    const opId = parseIdentifier(rawResult['opId'], `results[${index}].opId`);
    const statusValue = rawResult['status'];
    if (!isPushStatus(statusValue)) {
      throw new Error(`transport returned invalid results[${index}].status`);
    }

    results.push({
      opId,
      status: statusValue
    });
  }

  return {
    clientId,
    results
  };
}

function parseSyncItem(value: unknown, index: number): VfsCrdtSyncItem {
  if (!isRecord(value)) {
    throw new Error(`transport returned invalid items[${index}]`);
  }

  const parsedItem: VfsCrdtSyncItem = {
    opId: parseIdentifier(value['opId'], `items[${index}].opId`),
    itemId: parseIdentifier(value['itemId'], `items[${index}].itemId`),
    opType: parseOpType(value['opType'], `items[${index}].opType`),
    principalType: parseNullablePrincipalType(
      value['principalType'],
      `items[${index}].principalType`
    ),
    principalId: parseOptionalIdentifier(
      value['principalId'],
      `items[${index}].principalId`
    ),
    accessLevel: parseNullableAccessLevel(
      value['accessLevel'],
      `items[${index}].accessLevel`
    ),
    parentId: parseOptionalIdentifier(
      value['parentId'],
      `items[${index}].parentId`
    ),
    childId: parseOptionalIdentifier(
      value['childId'],
      `items[${index}].childId`
    ),
    actorId: parseOptionalIdentifier(
      value['actorId'],
      `items[${index}].actorId`
    ),
    sourceTable: parseRequiredString(
      value['sourceTable'],
      `items[${index}].sourceTable`
    ),
    sourceId: parseIdentifier(value['sourceId'], `items[${index}].sourceId`),
    occurredAt: parseOccurredAtMs(
      value['occurredAtMs'],
      `items[${index}].occurredAtMs`
    )
  };

  const encryptedPayload = parseOptionalNullableString(
    value['encryptedPayload'],
    `items[${index}].encryptedPayload`
  );
  const keyEpochValue = value['keyEpoch'];
  if (encryptedPayload !== undefined && encryptedPayload !== null) {
    if (
      typeof keyEpochValue !== 'number' ||
      !Number.isInteger(keyEpochValue) ||
      !Number.isSafeInteger(keyEpochValue) ||
      keyEpochValue < 1
    ) {
      throw new Error(
        `transport returned invalid encrypted envelope at items[${index}]`
      );
    }

    parsedItem.encryptedPayload = encryptedPayload;
    parsedItem.keyEpoch = keyEpochValue;
  }

  const encryptionNonce = parseOptionalNullableString(
    value['encryptionNonce'],
    `items[${index}].encryptionNonce`
  );
  if (encryptionNonce !== undefined && encryptionNonce !== null) {
    parsedItem.encryptionNonce = encryptionNonce;
  }

  const encryptionAad = parseOptionalNullableString(
    value['encryptionAad'],
    `items[${index}].encryptionAad`
  );
  if (encryptionAad !== undefined && encryptionAad !== null) {
    parsedItem.encryptionAad = encryptionAad;
  }

  const encryptionSignature = parseOptionalNullableString(
    value['encryptionSignature'],
    `items[${index}].encryptionSignature`
  );
  if (encryptionSignature !== undefined && encryptionSignature !== null) {
    parsedItem.encryptionSignature = encryptionSignature;
  }

  if (
    parsedItem.opType === 'link_add' ||
    parsedItem.opType === 'link_remove' ||
    parsedItem.opType === 'link_reassign'
  ) {
    /**
     * Guardrail: link graph mutations must preserve the same child scope as
     * the CRDT operation identity and must never self-link. Rejecting malformed
     * remote payloads here prevents corrupted feed rows from entering replay.
     */
    const hasPlaintextLinkFields =
      parsedItem.parentId !== null || parsedItem.childId !== null;
    const shouldRequirePlaintextLinkFields =
      parsedItem.encryptedPayload === undefined;
    if (
      (shouldRequirePlaintextLinkFields &&
        (parsedItem.parentId === null || parsedItem.childId === null)) ||
      (hasPlaintextLinkFields &&
        (parsedItem.parentId === null ||
          parsedItem.childId === null ||
          parsedItem.childId !== parsedItem.itemId ||
          parsedItem.parentId === parsedItem.childId))
    ) {
      throw new Error(
        `transport returned invalid link payload at items[${index}]`
      );
    }
  }

  return parsedItem;
}

export function parseApiPullResponse(body: unknown): VfsCrdtSyncResponse {
  if (!isRecord(body)) {
    throw new Error('transport returned invalid pull response payload');
  }

  const rawItems = body['items'];
  if (rawItems !== undefined && !Array.isArray(rawItems)) {
    throw new Error('transport returned invalid pull response items');
  }
  const normalizedRawItems = Array.isArray(rawItems) ? rawItems : [];

  const rawNextCursor = body['nextCursor'];
  if (
    rawNextCursor !== undefined &&
    rawNextCursor !== null &&
    typeof rawNextCursor !== 'string'
  ) {
    throw new Error('transport returned invalid nextCursor');
  }
  const nextCursorValue =
    typeof rawNextCursor === 'string' ? rawNextCursor : null;

  const hasMoreValue = body['hasMore'];
  if (
    hasMoreValue !== undefined &&
    hasMoreValue !== null &&
    typeof hasMoreValue !== 'boolean'
  ) {
    throw new Error('transport returned invalid hasMore');
  }
  const normalizedHasMore = hasMoreValue === true;

  const parsedWriteIds = parseVfsCrdtLastReconciledWriteIds(
    body['lastReconciledWriteIds']
  );
  if (!parsedWriteIds.ok) {
    throw new Error(parsedWriteIds.error);
  }

  const items = normalizedRawItems.map((item, index) =>
    parseSyncItem(item, index)
  );
  return {
    items,
    nextCursor: nextCursorValue,
    hasMore: normalizedHasMore,
    lastReconciledWriteIds: parsedWriteIds.value,
    bloomFilter: parseBloomFilter(body['bloomFilter'])
  };
}

export function parseApiReconcileResponse(
  body: unknown
): VfsCrdtReconcileResponse {
  if (!isRecord(body)) {
    throw new Error('transport returned invalid reconcile response payload');
  }

  const clientId = parseIdentifier(body['clientId'], 'clientId');
  const rawCursor = parseRequiredString(body['cursor'], 'cursor');
  const parsedCursor = decodeVfsSyncCursor(rawCursor);
  if (!parsedCursor) {
    throw new Error('transport returned invalid reconcile cursor');
  }

  const parsedWriteIds = parseVfsCrdtLastReconciledWriteIds(
    body['lastReconciledWriteIds']
  );
  if (!parsedWriteIds.ok) {
    throw new Error(parsedWriteIds.error);
  }

  return {
    clientId,
    cursor: rawCursor,
    lastReconciledWriteIds: parsedWriteIds.value
  };
}
