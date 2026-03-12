import type {
  VfsAclAccessLevel,
  VfsAclPrincipalType,
  VfsCrdtOpType,
  VfsCrdtPushStatus
} from '@tearleads/shared';
import { decodeBase64ToBytes } from '../protocol/syncProtobufNormalization.js';

type RecordValue = Record<string, unknown>;

const OP_TYPE_ENUM_NAME_MAP: Record<string, VfsCrdtOpType> = {
  VFS_CRDT_OP_TYPE_ACL_ADD: 'acl_add',
  VFS_CRDT_OP_TYPE_ACL_REMOVE: 'acl_remove',
  VFS_CRDT_OP_TYPE_LINK_ADD: 'link_add',
  VFS_CRDT_OP_TYPE_LINK_REMOVE: 'link_remove',
  VFS_CRDT_OP_TYPE_ITEM_UPSERT: 'item_upsert',
  VFS_CRDT_OP_TYPE_ITEM_DELETE: 'item_delete'
};

const OP_TYPE_ENUM_NUMERIC_MAP: Record<number, VfsCrdtOpType> = {
  1: 'acl_add',
  2: 'acl_remove',
  3: 'link_add',
  4: 'link_remove',
  5: 'item_upsert',
  6: 'item_delete'
};

const PRINCIPAL_TYPE_ENUM_NAME_MAP: Record<string, VfsAclPrincipalType> = {
  VFS_ACL_PRINCIPAL_TYPE_USER: 'user',
  VFS_ACL_PRINCIPAL_TYPE_GROUP: 'group',
  VFS_ACL_PRINCIPAL_TYPE_ORGANIZATION: 'organization'
};

const PRINCIPAL_TYPE_ENUM_NUMERIC_MAP: Record<number, VfsAclPrincipalType> = {
  1: 'user',
  2: 'group',
  3: 'organization'
};

const ACCESS_LEVEL_ENUM_NAME_MAP: Record<string, VfsAclAccessLevel> = {
  VFS_ACL_ACCESS_LEVEL_READ: 'read',
  VFS_ACL_ACCESS_LEVEL_WRITE: 'write',
  VFS_ACL_ACCESS_LEVEL_ADMIN: 'admin'
};

const ACCESS_LEVEL_ENUM_NUMERIC_MAP: Record<number, VfsAclAccessLevel> = {
  1: 'read',
  2: 'write',
  3: 'admin'
};

const PUSH_STATUS_ENUM_NAME_MAP: Record<string, VfsCrdtPushStatus> = {
  VFS_CRDT_PUSH_STATUS_APPLIED: 'applied',
  VFS_CRDT_PUSH_STATUS_ALREADY_APPLIED: 'alreadyApplied',
  VFS_CRDT_PUSH_STATUS_STALE_WRITE_ID: 'staleWriteId',
  VFS_CRDT_PUSH_STATUS_OUTDATED_OP: 'outdatedOp',
  VFS_CRDT_PUSH_STATUS_INVALID_OP: 'invalidOp',
  VFS_CRDT_PUSH_STATUS_ENCRYPTED_ENVELOPE_UNSUPPORTED:
    'encryptedEnvelopeUnsupported'
};

const PUSH_STATUS_ENUM_NUMERIC_MAP: Record<number, VfsCrdtPushStatus> = {
  1: 'applied',
  2: 'staleWriteId',
  3: 'outdatedOp',
  4: 'invalidOp',
  5: 'alreadyApplied',
  6: 'encryptedEnvelopeUnsupported'
};

function isRecord(value: unknown): value is RecordValue {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseOptionalBytes(
  value: unknown,
  fieldName: string
): Uint8Array | null {
  if (value === undefined || value === null) {
    return null;
  }

  if (value instanceof Uint8Array) {
    return value;
  }

  if (typeof value === 'string') {
    const bytes = decodeBase64ToBytes(value);
    if (!bytes || bytes.length === 0) {
      throw new Error(`transport returned invalid ${fieldName}`);
    }
    return bytes;
  }

  if (Array.isArray(value)) {
    const output: number[] = [];
    for (const candidate of value) {
      if (
        typeof candidate !== 'number' ||
        !Number.isInteger(candidate) ||
        candidate < 0 ||
        candidate > 255
      ) {
        throw new Error(`transport returned invalid ${fieldName}`);
      }
      output.push(candidate);
    }
    return output.length > 0 ? new Uint8Array(output) : null;
  }

  throw new Error(`transport returned invalid ${fieldName}`);
}

function bytesToUuid(bytes: Uint8Array): string {
  let hex = '';
  for (const b of bytes) {
    hex += b.toString(16).padStart(2, '0');
  }
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(
    16,
    20
  )}-${hex.slice(20)}`;
}

function bytesToIdentifier(bytes: Uint8Array): string {
  if (bytes.length === 16) {
    return bytesToUuid(bytes);
  }

  return new TextDecoder().decode(bytes);
}

function parseIdentifierFromBytes(
  source: RecordValue,
  options: {
    bytesKey: string;
    fieldName: string;
  }
): string | undefined {
  const raw = source[options.bytesKey];
  if (raw === undefined || raw === null) {
    return undefined;
  }

  const bytes = parseOptionalBytes(raw, options.fieldName);
  if (!bytes || bytes.length === 0) {
    throw new Error(`transport returned invalid ${options.fieldName}`);
  }

  const value = bytesToIdentifier(bytes).trim();
  if (value.length === 0) {
    throw new Error(`transport returned invalid ${options.fieldName}`);
  }

  return value;
}

function parseEnumNumber(value: unknown, fieldName: string): number {
  if (typeof value === 'number' && Number.isInteger(value)) {
    return value;
  }

  if (typeof value === 'string') {
    if (/^-?[0-9]+$/u.test(value)) {
      return Number.parseInt(value, 10);
    }

    throw new Error(`transport returned invalid ${fieldName}`);
  }

  throw new Error(`transport returned invalid ${fieldName}`);
}

function parseEnumValue<T>(
  source: RecordValue,
  options: {
    enumKey: string;
    fieldName: string;
    nameMap: Record<string, T>;
    numericMap: Record<number, T>;
    allowUnspecified?: boolean;
  }
): T | null {
  const enumValue = source[options.enumKey];
  if (enumValue === undefined || enumValue === null) {
    return null;
  }

  if (typeof enumValue === 'string') {
    if (options.allowUnspecified && enumValue.endsWith('_UNSPECIFIED')) {
      return null;
    }

    const mappedByName = options.nameMap[enumValue];
    if (mappedByName) {
      return mappedByName;
    }
  }

  const enumNumericValue = parseEnumNumber(enumValue, options.fieldName);
  if (options.allowUnspecified && enumNumericValue === 0) {
    return null;
  }

  const mappedByNumber = options.numericMap[enumNumericValue];
  if (mappedByNumber) {
    return mappedByNumber;
  }

  throw new Error(`transport returned invalid ${options.fieldName}`);
}

function parseUint64AsMs(value: unknown, fieldName: string): number {
  if (typeof value === 'number') {
    if (
      Number.isFinite(value) &&
      Number.isInteger(value) &&
      value >= 0 &&
      value <= Number.MAX_SAFE_INTEGER
    ) {
      return value;
    }
    throw new Error(`transport returned invalid ${fieldName}`);
  }

  if (typeof value === 'bigint') {
    if (value >= 0n && value <= BigInt(Number.MAX_SAFE_INTEGER)) {
      return Number(value);
    }
    throw new Error(`transport returned invalid ${fieldName}`);
  }

  if (typeof value === 'string' && /^[0-9]+$/u.test(value)) {
    const parsed = Number.parseInt(value, 10);
    if (
      Number.isFinite(parsed) &&
      Number.isInteger(parsed) &&
      parsed >= 0 &&
      parsed <= Number.MAX_SAFE_INTEGER
    ) {
      return parsed;
    }
  }

  throw new Error(`transport returned invalid ${fieldName}`);
}

export function normalizePushResponseRecord(value: unknown): unknown {
  if (!isRecord(value)) {
    return value;
  }

  const normalized: RecordValue = { ...value };
  const clientId = parseIdentifierFromBytes(value, {
    bytesKey: 'clientIdBytes',
    fieldName: 'clientId'
  });
  if (clientId) {
    normalized['clientId'] = clientId;
  }

  const rawResults = value['results'];
  if (!Array.isArray(rawResults)) {
    return normalized;
  }

  normalized['results'] = rawResults.map((entry, index) => {
    if (!isRecord(entry)) {
      return entry;
    }

    const normalizedResult: RecordValue = { ...entry };
    const opId = parseIdentifierFromBytes(entry, {
      bytesKey: 'opIdBytes',
      fieldName: `results[${index}].opId`
    });
    if (opId) {
      normalizedResult['opId'] = opId;
    }

    const status = parseEnumValue(entry, {
      enumKey: 'statusEnum',
      fieldName: `results[${index}].status`,
      nameMap: PUSH_STATUS_ENUM_NAME_MAP,
      numericMap: PUSH_STATUS_ENUM_NUMERIC_MAP
    });
    if (status) {
      normalizedResult['status'] = status;
    }

    return normalizedResult;
  });

  return normalized;
}

export function normalizeSyncItemRecord(
  value: unknown,
  index: number
): unknown {
  if (!isRecord(value)) {
    return value;
  }

  const normalized: RecordValue = { ...value };

  const opId = parseIdentifierFromBytes(value, {
    bytesKey: 'opIdBytes',
    fieldName: `items[${index}].opId`
  });
  if (opId) {
    normalized['opId'] = opId;
  }

  const itemId = parseIdentifierFromBytes(value, {
    bytesKey: 'itemIdBytes',
    fieldName: `items[${index}].itemId`
  });
  if (itemId) {
    normalized['itemId'] = itemId;
  }

  const opType = parseEnumValue(value, {
    enumKey: 'opTypeEnum',
    fieldName: `items[${index}].opType`,
    nameMap: OP_TYPE_ENUM_NAME_MAP,
    numericMap: OP_TYPE_ENUM_NUMERIC_MAP
  });
  if (opType) {
    normalized['opType'] = opType;
  }

  const principalType = parseEnumValue(value, {
    enumKey: 'principalTypeEnum',
    fieldName: `items[${index}].principalType`,
    nameMap: PRINCIPAL_TYPE_ENUM_NAME_MAP,
    numericMap: PRINCIPAL_TYPE_ENUM_NUMERIC_MAP,
    allowUnspecified: true
  });
  if (principalType !== null) {
    normalized['principalType'] = principalType;
  }

  const principalId = parseIdentifierFromBytes(value, {
    bytesKey: 'principalIdBytes',
    fieldName: `items[${index}].principalId`
  });
  if (principalId) {
    normalized['principalId'] = principalId;
  }

  const accessLevel = parseEnumValue(value, {
    enumKey: 'accessLevelEnum',
    fieldName: `items[${index}].accessLevel`,
    nameMap: ACCESS_LEVEL_ENUM_NAME_MAP,
    numericMap: ACCESS_LEVEL_ENUM_NUMERIC_MAP,
    allowUnspecified: true
  });
  if (accessLevel !== null) {
    normalized['accessLevel'] = accessLevel;
  }

  const parentId = parseIdentifierFromBytes(value, {
    bytesKey: 'parentIdBytes',
    fieldName: `items[${index}].parentId`
  });
  if (parentId) {
    normalized['parentId'] = parentId;
  }

  const childId = parseIdentifierFromBytes(value, {
    bytesKey: 'childIdBytes',
    fieldName: `items[${index}].childId`
  });
  if (childId) {
    normalized['childId'] = childId;
  }

  const actorId = parseIdentifierFromBytes(value, {
    bytesKey: 'actorIdBytes',
    fieldName: `items[${index}].actorId`
  });
  if (actorId) {
    normalized['actorId'] = actorId;
  }

  const sourceId = parseIdentifierFromBytes(value, {
    bytesKey: 'sourceIdBytes',
    fieldName: `items[${index}].sourceId`
  });
  if (sourceId) {
    normalized['sourceId'] = sourceId;
  }

  const occurredAtMs = value['occurredAtMs'];
  if (occurredAtMs !== undefined && occurredAtMs !== null) {
    normalized['occurredAt'] = new Date(
      parseUint64AsMs(occurredAtMs, `items[${index}].occurredAt`)
    ).toISOString();
  }

  return normalized;
}

export function normalizeReconcileResponseRecord(value: unknown): unknown {
  if (!isRecord(value)) {
    return value;
  }

  const normalized: RecordValue = { ...value };
  const clientId = parseIdentifierFromBytes(value, {
    bytesKey: 'clientIdBytes',
    fieldName: 'clientId'
  });
  if (clientId) {
    normalized['clientId'] = clientId;
  }

  return normalized;
}
