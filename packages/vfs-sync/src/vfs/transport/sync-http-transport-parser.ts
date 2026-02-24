import type {
  VfsAclAccessLevel,
  VfsAclPrincipalType,
  VfsCrdtOpType,
  VfsCrdtPushResponse,
  VfsCrdtPushStatus,
  VfsCrdtReconcileResponse,
  VfsCrdtSyncItem,
  VfsCrdtSyncResponse
} from '@tearleads/shared';
import { parseVfsCrdtLastReconciledWriteIds } from '../protocol/sync-crdt-reconcile.js';
import { decodeVfsSyncCursor } from '../protocol/sync-cursor.js';

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
  if (value === null) {
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
  if (value === null) {
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
  if (value === null) {
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

export function parseApiPushResponse(body: unknown): VfsCrdtPushResponse {
  /**
   * Guardrail: push acknowledgements are authoritative for queue advancement.
   * We therefore parse every field explicitly and fail closed on any shape drift.
   */
  if (!isRecord(body)) {
    throw new Error('transport returned invalid push response payload');
  }

  const clientId = parseRequiredString(body['clientId'], 'clientId');
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
  if (!isRecord(value)) {
    throw new Error(`transport returned invalid items[${index}]`);
  }

  const parsedItem: VfsCrdtSyncItem = {
    opId: parseRequiredString(value['opId'], `items[${index}].opId`),
    itemId: parseRequiredString(value['itemId'], `items[${index}].itemId`),
    opType: parseOpType(value['opType'], `items[${index}].opType`),
    principalType: parseNullablePrincipalType(
      value['principalType'],
      `items[${index}].principalType`
    ),
    principalId: parseNullableString(
      value['principalId'],
      `items[${index}].principalId`
    ),
    accessLevel: parseNullableAccessLevel(
      value['accessLevel'],
      `items[${index}].accessLevel`
    ),
    parentId: parseNullableString(
      value['parentId'],
      `items[${index}].parentId`
    ),
    childId: parseNullableString(value['childId'], `items[${index}].childId`),
    actorId: parseNullableString(value['actorId'], `items[${index}].actorId`),
    sourceTable: parseRequiredString(
      value['sourceTable'],
      `items[${index}].sourceTable`
    ),
    sourceId: parseRequiredString(
      value['sourceId'],
      `items[${index}].sourceId`
    ),
    occurredAt: parseIsoString(
      value['occurredAt'],
      `items[${index}].occurredAt`
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
  if (!Array.isArray(rawItems)) {
    throw new Error('transport returned invalid pull response items');
  }

  const nextCursorValue = body['nextCursor'];
  if (nextCursorValue !== null && typeof nextCursorValue !== 'string') {
    throw new Error('transport returned invalid nextCursor');
  }

  const hasMoreValue = body['hasMore'];
  if (typeof hasMoreValue !== 'boolean') {
    throw new Error('transport returned invalid hasMore');
  }

  const parsedWriteIds = parseVfsCrdtLastReconciledWriteIds(
    body['lastReconciledWriteIds']
  );
  if (!parsedWriteIds.ok) {
    throw new Error(parsedWriteIds.error);
  }

  const items = rawItems.map((item, index) => parseSyncItem(item, index));
  return {
    items,
    nextCursor: nextCursorValue,
    hasMore: hasMoreValue,
    lastReconciledWriteIds: parsedWriteIds.value
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
  if (!isRecord(body)) {
    throw new Error('transport returned invalid reconcile response payload');
  }

  const clientId = parseRequiredString(body['clientId'], 'clientId');
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

export function parseErrorMessage(status: number, body: unknown): string {
  if (isRecord(body) && typeof body['error'] === 'string') {
    const normalized = body['error'].trim();
    if (normalized.length > 0) {
      return normalized;
    }
  }

  return `request failed with status ${status}`;
}
