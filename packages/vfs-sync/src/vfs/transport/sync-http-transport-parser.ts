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
  normalizePushResponseRecord,
  normalizeReconcileResponseRecord,
  normalizeSyncItemRecord
} from './syncHttpTransportCompactNormalization.js';

interface ParsedApiErrorResponse {
  message: string;
  code: string | null;
  requestedCursor: string | null;
  oldestAvailableCursor: string | null;
}

const VALID_OP_TYPES: VfsCrdtOpType[] = [
  'acl_add',
  'acl_remove',
  'link_add',
  'link_remove',
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

function parseIsoString(value: unknown, fieldName: string): string {
  const normalized = parseRequiredString(value, fieldName);
  const parsedMs = Date.parse(normalized);
  if (!Number.isFinite(parsedMs)) {
    throw new Error(`transport returned invalid ${fieldName}`);
  }

  return new Date(parsedMs).toISOString();
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
  /**
   * Guardrail: push acknowledgements are authoritative for queue advancement.
   * We therefore parse every field explicitly and fail closed on any shape drift.
   */
  const normalizedBody = normalizePushResponseRecord(body);
  if (!isRecord(normalizedBody)) {
    throw new Error('transport returned invalid push response payload');
  }

  const clientId = parseRequiredString(normalizedBody['clientId'], 'clientId');
  const rawResults = normalizedBody['results'];
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

    const opId = parseRequiredString(
      rawResult['opId'],
      `results[${index}].opId`
    );
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
  const normalizedValue = normalizeSyncItemRecord(value, index);
  if (!isRecord(normalizedValue)) {
    throw new Error(`transport returned invalid items[${index}]`);
  }

  const parsedItem: VfsCrdtSyncItem = {
    opId: parseRequiredString(normalizedValue['opId'], `items[${index}].opId`),
    itemId: parseRequiredString(
      normalizedValue['itemId'],
      `items[${index}].itemId`
    ),
    opType: parseOpType(normalizedValue['opType'], `items[${index}].opType`),
    principalType: parseNullablePrincipalType(
      normalizedValue['principalType'],
      `items[${index}].principalType`
    ),
    principalId: parseNullableString(
      normalizedValue['principalId'],
      `items[${index}].principalId`
    ),
    accessLevel: parseNullableAccessLevel(
      normalizedValue['accessLevel'],
      `items[${index}].accessLevel`
    ),
    parentId: parseNullableString(
      normalizedValue['parentId'],
      `items[${index}].parentId`
    ),
    childId: parseNullableString(
      normalizedValue['childId'],
      `items[${index}].childId`
    ),
    actorId: parseNullableString(
      normalizedValue['actorId'],
      `items[${index}].actorId`
    ),
    sourceTable: parseRequiredString(
      normalizedValue['sourceTable'],
      `items[${index}].sourceTable`
    ),
    sourceId: parseRequiredString(
      normalizedValue['sourceId'],
      `items[${index}].sourceId`
    ),
    occurredAt: parseIsoString(
      normalizedValue['occurredAt'],
      `items[${index}].occurredAt`
    )
  };

  const encryptedPayload = parseOptionalNullableString(
    normalizedValue['encryptedPayload'],
    `items[${index}].encryptedPayload`
  );
  const keyEpochValue = normalizedValue['keyEpoch'];
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
    normalizedValue['encryptionNonce'],
    `items[${index}].encryptionNonce`
  );
  if (encryptionNonce !== undefined && encryptionNonce !== null) {
    parsedItem.encryptionNonce = encryptionNonce;
  }

  const encryptionAad = parseOptionalNullableString(
    normalizedValue['encryptionAad'],
    `items[${index}].encryptionAad`
  );
  if (encryptionAad !== undefined && encryptionAad !== null) {
    parsedItem.encryptionAad = encryptionAad;
  }

  const encryptionSignature = parseOptionalNullableString(
    normalizedValue['encryptionSignature'],
    `items[${index}].encryptionSignature`
  );
  if (encryptionSignature !== undefined && encryptionSignature !== null) {
    parsedItem.encryptionSignature = encryptionSignature;
  }

  if (parsedItem.opType === 'link_add' || parsedItem.opType === 'link_remove') {
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
  /**
   * Guardrail: pull pages are replayed into deterministic CRDT reducers.
   * Any invalid enum, timestamp, or cursor metadata must abort immediately so
   * we never commit partially-trusted feed state into local reconcile stores.
   */
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
  /**
   * Guardrail: reconcile responses are the durable checkpoint handshake between
   * local state and server state. Cursor or replica-clock corruption here would
   * poison stale-write recovery and future flush ordering.
   */
  const normalizedBody = normalizeReconcileResponseRecord(body);
  if (!isRecord(normalizedBody)) {
    throw new Error('transport returned invalid reconcile response payload');
  }

  const clientId = parseRequiredString(normalizedBody['clientId'], 'clientId');
  const rawCursor = parseRequiredString(normalizedBody['cursor'], 'cursor');
  const parsedCursor = decodeVfsSyncCursor(rawCursor);
  if (!parsedCursor) {
    throw new Error('transport returned invalid reconcile cursor');
  }

  const parsedWriteIds = parseVfsCrdtLastReconciledWriteIds(
    normalizedBody['lastReconciledWriteIds']
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

function parseErrorMessage(status: number, body: unknown): string {
  if (isRecord(body) && typeof body['error'] === 'string') {
    const normalized = body['error'].trim();
    if (normalized.length > 0) {
      return normalized;
    }
  }

  if (isRecord(body) && typeof body['message'] === 'string') {
    const normalized = body['message'].trim();
    if (normalized.length > 0) {
      return normalized;
    }
  }

  return `request failed with status ${status}`;
}

export function parseApiErrorResponse(
  status: number,
  body: unknown
): ParsedApiErrorResponse {
  const message = parseErrorMessage(status, body);
  if (!isRecord(body)) {
    return {
      message,
      code: null,
      requestedCursor: null,
      oldestAvailableCursor: null
    };
  }

  const codeRaw = body['code'];
  const requestedCursorRaw = body['requestedCursor'];
  const oldestAvailableCursorRaw = body['oldestAvailableCursor'];

  return {
    message,
    code:
      typeof codeRaw === 'string' && codeRaw.trim().length > 0
        ? codeRaw.trim()
        : null,
    requestedCursor:
      typeof requestedCursorRaw === 'string' &&
      requestedCursorRaw.trim().length > 0
        ? requestedCursorRaw.trim()
        : null,
    oldestAvailableCursor:
      typeof oldestAvailableCursorRaw === 'string' &&
      oldestAvailableCursorRaw.trim().length > 0
        ? oldestAvailableCursorRaw.trim()
        : null
  };
}
