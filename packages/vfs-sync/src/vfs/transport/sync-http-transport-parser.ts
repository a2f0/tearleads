import type {
  VfsCrdtPushResponse,
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
import {
  parseNullableAccessLevel,
  parseNullablePrincipalType,
  parseOpType,
  parsePushStatus
} from './syncHttpTransportEnumParsing.js';

export { parseApiErrorResponse } from './syncHttpTransportApiError.js';

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;
const OPAQUE_IDENTIFIER_PATTERN = /^[a-z0-9:-]+$/u;

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

  try {
    const decoded = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    if (decoded.length === 0) {
      return null;
    }

    return UUID_PATTERN.test(decoded) || isOpaqueIdentifier(decoded)
      ? decoded
      : null;
  } catch {
    return null;
  }
}

function parseIdentifier(value: unknown, fieldName: string): string {
  if (typeof value !== 'string') {
    throw new Error(`transport returned invalid ${fieldName}`);
  }
  const trimmed = value.trim();
  if (!trimmed) {
    throw new Error(`transport returned invalid ${fieldName}`);
  }

  const decoded = decodeIdentifier(trimmed);
  if (!decoded) {
    throw new Error(`transport returned invalid ${fieldName}`);
  }

  return decoded;
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

function parseOccurredAtMs(value: unknown, fieldName: string): string {
  if (typeof value !== 'string' || !/^[0-9]+$/u.test(value)) {
    throw new Error(`transport returned invalid ${fieldName}`);
  }

  const parsed = Number(value);
  if (!Number.isFinite(parsed) || !Number.isSafeInteger(parsed) || parsed < 0) {
    throw new Error(`transport returned invalid ${fieldName}`);
  }

  return new Date(parsed).toISOString();
}

function parseBloomFilter(value: unknown): VfsSyncBloomFilter | null {
  if (!value || !isRecord(value)) {
    return null;
  }

  const data = parseRequiredString(value['data'], 'bloomFilter.data');
  if (!decodeBase64ToBytes(data)) {
    throw new Error('transport returned invalid bloomFilter.data');
  }

  const capacity = value['capacity'];
  const errorRate = value['errorRate'];
  if (
    typeof capacity !== 'number' ||
    !Number.isFinite(capacity) ||
    !Number.isInteger(capacity) ||
    capacity < 1
  ) {
    throw new Error('transport returned invalid bloomFilter.capacity');
  }
  if (typeof errorRate !== 'number' || !Number.isFinite(errorRate)) {
    throw new Error('transport returned invalid bloomFilter.errorRate');
  }

  return {
    data,
    capacity,
    errorRate
  };
}

function parseLastReconciledWriteIds(value: unknown): Record<string, number> {
  if (value === undefined || value === null) {
    return {};
  }
  if (!isRecord(value)) {
    throw new Error(
      'lastReconciledWriteIds must be an object map of replicaId -> writeId'
    );
  }

  const normalized: Record<string, number> = {};
  for (const [replicaId, rawWriteId] of Object.entries(value)) {
    if (typeof rawWriteId !== 'string' || !/^[0-9]+$/u.test(rawWriteId)) {
      throw new Error(
        'lastReconciledWriteIds contains invalid writeId (must be a positive integer)'
      );
    }

    normalized[replicaId] = Number(rawWriteId);
  }

  const parsedWriteIds = parseVfsCrdtLastReconciledWriteIds(normalized);
  if (!parsedWriteIds.ok) {
    throw new Error(parsedWriteIds.error);
  }

  return parsedWriteIds.value;
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
    results.push({
      opId,
      status: parsePushStatus(rawResult['status'], `results[${index}].status`)
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

  const items = normalizedRawItems.map((item, index) =>
    parseSyncItem(item, index)
  );
  return {
    items,
    nextCursor: nextCursorValue,
    hasMore: normalizedHasMore,
    lastReconciledWriteIds: parseLastReconciledWriteIds(
      body['lastReconciledWriteIds']
    ),
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

  return {
    clientId,
    cursor: rawCursor,
    lastReconciledWriteIds: parseLastReconciledWriteIds(
      body['lastReconciledWriteIds']
    )
  };
}
