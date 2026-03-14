import { base64ToBytes } from './base64.js';
import type {
  VfsAclAccessLevel,
  VfsAclPrincipalType,
  VfsCrdtOpType,
  VfsCrdtSyncItem,
  VfsCrdtSyncResponse,
  VfsSyncItem,
  VfsSyncResponse
} from './vfsTypes.js';

function parseJsonObject<T>(rawJson: string): T {
  return JSON.parse(rawJson);
}

export function createConnectJsonPostInit(body: unknown) {
  return {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  };
}

export function parseConnectJsonString<T>(json: unknown): T {
  if (typeof json !== 'string') {
    return parseJsonObject('{}');
  }
  const trimmed = json.trim();
  if (trimmed.length === 0) {
    return parseJsonObject('{}');
  }
  return parseJsonObject(trimmed);
}

export function isPlainRecord(
  value: unknown
): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function parseConnectJsonEnvelopeBody(body: unknown): unknown {
  if (!isPlainRecord(body) || !('json' in body)) {
    return body;
  }

  const jsonValue = body['json'];
  if (typeof jsonValue !== 'string') {
    if (jsonValue === undefined || jsonValue === null) {
      return {};
    }
    return jsonValue;
  }

  const rawJson = jsonValue.trim();
  if (rawJson.length === 0) {
    return {};
  }

  try {
    return parseJsonObject(rawJson);
  } catch {
    throw new Error('transport returned invalid connect json envelope');
  }
}

function readNonEmptyString(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function readSafeInteger(value: unknown): number | null {
  if (
    typeof value === 'number' &&
    Number.isInteger(value) &&
    Number.isSafeInteger(value)
  ) {
    return value;
  }

  if (typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim();
  if (!/^-?\d+$/u.test(trimmed)) {
    return null;
  }

  const parsed = Number(trimmed);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

function bytesToUuid(bytes: Uint8Array): string {
  let hex = '';
  for (const byte of bytes) {
    hex += byte.toString(16).padStart(2, '0');
  }
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(
    12,
    16
  )}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function decodeIdentifierBytes(bytes: Uint8Array): string | null {
  if (bytes.length === 16) {
    return bytesToUuid(bytes);
  }

  try {
    const decoded = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    return /^[\u0020-\u007E]+$/u.test(decoded) ? decoded : null;
  } catch {
    return null;
  }
}

function normalizeIdentifier(value: unknown): string | null {
  const directValue = readNonEmptyString(value);
  if (!directValue) {
    return null;
  }

  const decodedBytes = base64ToBytes(directValue);
  if (!decodedBytes) {
    return directValue;
  }

  return decodeIdentifierBytes(decodedBytes) ?? directValue;
}

function normalizeIsoTimestamp(
  millisecondsValue: unknown,
  isoValue: unknown
): string | null {
  const milliseconds = readSafeInteger(millisecondsValue);
  if (milliseconds !== null) {
    return new Date(milliseconds).toISOString();
  }

  return readNonEmptyString(isoValue);
}

function normalizeAccessLevel(value: unknown): VfsAclAccessLevel | null {
  if (typeof value === 'number') {
    switch (value) {
      case 1:
        return 'read';
      case 2:
        return 'write';
      case 3:
        return 'admin';
      default:
        return null;
    }
  }

  const normalized = readNonEmptyString(value)?.toUpperCase();
  switch (normalized) {
    case 'READ':
    case 'VFS_ACL_ACCESS_LEVEL_READ':
      return 'read';
    case 'WRITE':
    case 'VFS_ACL_ACCESS_LEVEL_WRITE':
      return 'write';
    case 'ADMIN':
    case 'VFS_ACL_ACCESS_LEVEL_ADMIN':
      return 'admin';
    default:
      return null;
  }
}

function normalizePrincipalType(value: unknown): VfsAclPrincipalType | null {
  if (typeof value === 'number') {
    switch (value) {
      case 1:
        return 'user';
      case 2:
        return 'group';
      case 3:
        return 'organization';
      default:
        return null;
    }
  }

  const normalized = readNonEmptyString(value)?.toUpperCase();
  switch (normalized) {
    case 'USER':
    case 'VFS_ACL_PRINCIPAL_TYPE_USER':
      return 'user';
    case 'GROUP':
    case 'VFS_ACL_PRINCIPAL_TYPE_GROUP':
      return 'group';
    case 'ORGANIZATION':
    case 'VFS_ACL_PRINCIPAL_TYPE_ORGANIZATION':
      return 'organization';
    default:
      return null;
  }
}

function normalizeCrdtOpType(value: unknown): VfsCrdtOpType | null {
  if (typeof value === 'number') {
    switch (value) {
      case 1:
        return 'acl_add';
      case 2:
        return 'acl_remove';
      case 3:
        return 'link_add';
      case 4:
        return 'link_remove';
      case 5:
        return 'item_upsert';
      case 6:
        return 'item_delete';
      case 7:
        return 'link_reassign';
      default:
        return null;
    }
  }

  const normalized = readNonEmptyString(value)?.toUpperCase();
  switch (normalized) {
    case 'ACL_ADD':
    case 'VFS_CRDT_OP_TYPE_ACL_ADD':
      return 'acl_add';
    case 'ACL_REMOVE':
    case 'VFS_CRDT_OP_TYPE_ACL_REMOVE':
      return 'acl_remove';
    case 'LINK_ADD':
    case 'VFS_CRDT_OP_TYPE_LINK_ADD':
      return 'link_add';
    case 'LINK_REMOVE':
    case 'VFS_CRDT_OP_TYPE_LINK_REMOVE':
      return 'link_remove';
    case 'ITEM_UPSERT':
    case 'VFS_CRDT_OP_TYPE_ITEM_UPSERT':
      return 'item_upsert';
    case 'ITEM_DELETE':
    case 'VFS_CRDT_OP_TYPE_ITEM_DELETE':
      return 'item_delete';
    case 'LINK_REASSIGN':
    case 'VFS_CRDT_OP_TYPE_LINK_REASSIGN':
      return 'link_reassign';
    default:
      return null;
  }
}

function normalizeSyncItem(value: unknown): VfsSyncItem | null {
  if (!isPlainRecord(value)) {
    return null;
  }

  const changeId = normalizeIdentifier(value['changeId']);
  const itemId = normalizeIdentifier(value['itemId']);
  const changeType = readNonEmptyString(value['changeType']);
  const changedAt = normalizeIsoTimestamp(
    value['changedAtMs'],
    value['changedAt']
  );

  if (!changeId || !itemId || !changeType || !changedAt) {
    return null;
  }

  return {
    changeId,
    itemId,
    changeType,
    changedAt,
    objectType: readNonEmptyString(value['objectType']),
    encryptedName: readNonEmptyString(value['encryptedName']),
    ownerId: normalizeIdentifier(value['ownerId']),
    createdAt: normalizeIsoTimestamp(value['createdAtMs'], value['createdAt']),
    accessLevel: normalizeAccessLevel(value['accessLevel']) ?? 'read'
  };
}

function normalizeCrdtSyncItem(value: unknown): VfsCrdtSyncItem | null {
  if (!isPlainRecord(value)) {
    return null;
  }

  const opId = normalizeIdentifier(value['opId']);
  const itemId = normalizeIdentifier(value['itemId']);
  const opType = normalizeCrdtOpType(value['opType']);
  const sourceTable = readNonEmptyString(value['sourceTable']);
  const sourceId = normalizeIdentifier(value['sourceId']);
  const occurredAt = normalizeIsoTimestamp(
    value['occurredAtMs'],
    value['occurredAt']
  );

  if (!opId || !itemId || !opType || !sourceTable || !sourceId || !occurredAt) {
    return null;
  }

  return {
    opId,
    itemId,
    opType,
    principalType: normalizePrincipalType(value['principalType']),
    principalId: normalizeIdentifier(value['principalId']),
    accessLevel: normalizeAccessLevel(value['accessLevel']),
    parentId: normalizeIdentifier(value['parentId']),
    childId: normalizeIdentifier(value['childId']),
    actorId: normalizeIdentifier(value['actorId']),
    sourceTable,
    sourceId,
    occurredAt,
    encryptedPayload: readNonEmptyString(value['encryptedPayload']),
    keyEpoch: readSafeInteger(value['keyEpoch']),
    encryptionNonce: readNonEmptyString(value['encryptionNonce']),
    encryptionAad: readNonEmptyString(value['encryptionAad']),
    encryptionSignature: readNonEmptyString(value['encryptionSignature'])
  };
}

function normalizeLastReconciledWriteIds(
  value: unknown
): Record<string, number> {
  if (!isPlainRecord(value)) {
    return {};
  }

  const normalized: Record<string, number> = {};
  for (const [replicaId, writeId] of Object.entries(value)) {
    const trimmedReplicaId = replicaId.trim();
    const normalizedWriteId = readSafeInteger(writeId);
    if (
      trimmedReplicaId.length === 0 ||
      normalizedWriteId === null ||
      normalizedWriteId < 1
    ) {
      continue;
    }

    normalized[trimmedReplicaId] = normalizedWriteId;
  }

  return normalized;
}

export function normalizeVfsSyncConnectPayload(
  payload: unknown
): VfsSyncResponse {
  const recordPayload = isPlainRecord(payload) ? payload : {};
  const rawItems = recordPayload['items'];

  return {
    items: Array.isArray(rawItems)
      ? rawItems
          .map((item) => normalizeSyncItem(item))
          .filter((item): item is VfsSyncItem => item !== null)
      : [],
    nextCursor: readNonEmptyString(recordPayload['nextCursor']),
    hasMore: recordPayload['hasMore'] === true
  };
}

export function normalizeVfsCrdtSyncConnectPayload(
  payload: unknown
): VfsCrdtSyncResponse {
  const recordPayload = isPlainRecord(payload) ? payload : {};
  const rawItems = recordPayload['items'];
  const rawBloomFilter = recordPayload['bloomFilter'];

  return {
    items: Array.isArray(rawItems)
      ? rawItems
          .map((item) => normalizeCrdtSyncItem(item))
          .filter((item): item is VfsCrdtSyncItem => item !== null)
      : [],
    nextCursor: readNonEmptyString(recordPayload['nextCursor']),
    hasMore: recordPayload['hasMore'] === true,
    lastReconciledWriteIds: normalizeLastReconciledWriteIds(
      recordPayload['lastReconciledWriteIds']
    ),
    ...(isPlainRecord(rawBloomFilter)
      ? {
          bloomFilter: {
            data: readNonEmptyString(rawBloomFilter['data']) ?? '',
            capacity: readSafeInteger(rawBloomFilter['capacity']) ?? 0,
            errorRate:
              typeof rawBloomFilter['errorRate'] === 'number'
                ? rawBloomFilter['errorRate']
                : 0
          }
        }
      : {})
  };
}
