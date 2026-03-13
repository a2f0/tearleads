import type {
  VfsAclAccessLevel,
  VfsAclPrincipalType,
  VfsCrdtOpType,
  VfsCrdtPushOperation
} from '@tearleads/shared';
import { isRecord } from '@tearleads/shared';
import {
  parseEnumWithCompactFallback,
  parseIdentifierWithCompactFallback,
  parseOccurredAtWithCompactFallback,
  parsePositiveSafeIntegerWithCompactFallback
} from './vfsDirectCrdtCompactDecoding.js';

const MAX_CLIENT_ID_LENGTH = 128;
const MAX_PUSH_OPERATIONS = 500;

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

export interface ParsedPushOperation {
  status: 'parsed' | 'invalid';
  opId: string;
  operation?: VfsCrdtPushOperation;
}

interface ParsedPushPayload {
  clientId: string;
  operations: ParsedPushOperation[];
}

type ParsePushPayloadResult =
  | { ok: true; value: ParsedPushPayload }
  | { ok: false; error: string };

function normalizeRequiredString(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function isValidOpType(value: unknown): value is VfsCrdtOpType {
  return (
    typeof value === 'string' &&
    VALID_OP_TYPES.some((candidate) => candidate === value)
  );
}

function isValidPrincipalType(value: unknown): value is VfsAclPrincipalType {
  return (
    typeof value === 'string' &&
    VALID_PRINCIPAL_TYPES.some((candidate) => candidate === value)
  );
}

function isValidAccessLevel(value: unknown): value is VfsAclAccessLevel {
  return (
    typeof value === 'string' &&
    VALID_ACCESS_LEVELS.some((candidate) => candidate === value)
  );
}

function parseClientId(value: unknown, bytesValue: unknown): string | null {
  const normalized = parseIdentifierWithCompactFallback(value, bytesValue);
  if (!normalized) {
    return null;
  }

  if (normalized.length > MAX_CLIENT_ID_LENGTH || normalized.includes(':')) {
    return null;
  }

  return normalized;
}

function hasCompactEnumField(
  value: Record<string, unknown>,
  key: string
): boolean {
  if (!Object.hasOwn(value, key)) {
    return false;
  }

  const enumValue = value[key];
  if (enumValue === 0 || enumValue === 0n || enumValue === '0') {
    return false;
  }
  return enumValue !== undefined && enumValue !== null;
}

function hasCompactBytesField(
  value: Record<string, unknown>,
  key: string
): boolean {
  if (!Object.hasOwn(value, key)) {
    return false;
  }

  const bytesValue = value[key];
  if (bytesValue instanceof Uint8Array) {
    return bytesValue.length > 0;
  }
  if (Array.isArray(bytesValue)) {
    return bytesValue.length > 0;
  }
  if (typeof bytesValue === 'string') {
    return bytesValue.length > 0;
  }
  return bytesValue !== undefined && bytesValue !== null;
}

function parsePushOperation(
  value: unknown,
  index: number,
  expectedClientId: string
): ParsedPushOperation {
  if (!isRecord(value)) {
    return {
      status: 'invalid',
      opId: `invalid-${index}`
    };
  }

  const opId =
    parseIdentifierWithCompactFallback(value['opId'], value['opIdBytes']) ??
    `invalid-${index}`;
  const opType = parseEnumWithCompactFallback<VfsCrdtOpType>(
    value['opType'],
    value['opTypeEnum'],
    {
      isLegacyValue: isValidOpType,
      numericMap: OP_TYPE_ENUM_NUMERIC_MAP,
      nameMap: OP_TYPE_ENUM_NAME_MAP
    }
  );
  const itemId = parseIdentifierWithCompactFallback(
    value['itemId'],
    value['itemIdBytes']
  );
  const replicaId = parseClientId(value['replicaId'], value['replicaIdBytes']);
  const writeId = parsePositiveSafeIntegerWithCompactFallback(
    value['writeId'],
    value['writeIdU64']
  );
  const occurredAt = parseOccurredAtWithCompactFallback(
    value['occurredAt'],
    value['occurredAtMs']
  );

  if (
    !opType ||
    !itemId ||
    !replicaId ||
    !writeId ||
    !occurredAt ||
    replicaId !== expectedClientId
  ) {
    return {
      status: 'invalid',
      opId
    };
  }

  const operation: VfsCrdtPushOperation = {
    opId,
    opType,
    itemId,
    replicaId,
    writeId,
    occurredAt
  };

  // Check for encrypted envelope
  const encryptedPayload = normalizeRequiredString(value['encryptedPayload']);
  const hasEncryptedPayload = encryptedPayload !== null;

  // Validate encrypted envelope fields if present
  if (hasEncryptedPayload) {
    const keyEpoch = value['keyEpoch'];
    if (
      typeof keyEpoch !== 'number' ||
      !Number.isInteger(keyEpoch) ||
      keyEpoch < 1
    ) {
      return {
        status: 'invalid',
        opId
      };
    }

    const encryptionNonce = normalizeRequiredString(value['encryptionNonce']);
    const encryptionAad = normalizeRequiredString(value['encryptionAad']);
    const encryptionSignature = normalizeRequiredString(
      value['encryptionSignature']
    );
    if (!encryptionNonce || !encryptionAad || !encryptionSignature) {
      return {
        status: 'invalid',
        opId
      };
    }

    operation.encryptedPayload = encryptedPayload;
    operation.keyEpoch = keyEpoch;
    operation.encryptionNonce = encryptionNonce;
    operation.encryptionAad = encryptionAad;
    operation.encryptionSignature = encryptionSignature;
  }

  if (opType === 'acl_add' || opType === 'acl_remove') {
    const includesPlaintextAclFields =
      Object.hasOwn(value, 'principalType') ||
      Object.hasOwn(value, 'principalId') ||
      Object.hasOwn(value, 'accessLevel') ||
      hasCompactEnumField(value, 'principalTypeEnum') ||
      hasCompactBytesField(value, 'principalIdBytes') ||
      hasCompactEnumField(value, 'accessLevelEnum');
    if (hasEncryptedPayload && includesPlaintextAclFields) {
      return {
        status: 'invalid',
        opId
      };
    }

    const principalType = parseEnumWithCompactFallback<VfsAclPrincipalType>(
      value['principalType'],
      value['principalTypeEnum'],
      {
        isLegacyValue: isValidPrincipalType,
        numericMap: PRINCIPAL_TYPE_ENUM_NUMERIC_MAP,
        nameMap: PRINCIPAL_TYPE_ENUM_NAME_MAP,
        allowUnspecified: true
      }
    );
    const principalId = parseIdentifierWithCompactFallback(
      value['principalId'],
      value['principalIdBytes']
    );

    if (!hasEncryptedPayload) {
      if (!principalType || !principalId) {
        return {
          status: 'invalid',
          opId
        };
      }
    }

    if (principalType) {
      operation.principalType = principalType;
    }
    if (principalId) {
      operation.principalId = principalId;
    }

    if (opType === 'acl_add') {
      const accessLevel = parseEnumWithCompactFallback<VfsAclAccessLevel>(
        value['accessLevel'],
        value['accessLevelEnum'],
        {
          isLegacyValue: isValidAccessLevel,
          numericMap: ACCESS_LEVEL_ENUM_NUMERIC_MAP,
          nameMap: ACCESS_LEVEL_ENUM_NAME_MAP,
          allowUnspecified: true
        }
      );
      if (!hasEncryptedPayload && !accessLevel) {
        return {
          status: 'invalid',
          opId
        };
      }

      if (accessLevel) {
        operation.accessLevel = accessLevel;
      }
    }
  }

  if (opType === 'link_add' || opType === 'link_remove') {
    const includesPlaintextLinkFields =
      Object.hasOwn(value, 'parentId') ||
      Object.hasOwn(value, 'childId') ||
      hasCompactBytesField(value, 'parentIdBytes') ||
      hasCompactBytesField(value, 'childIdBytes');
    if (hasEncryptedPayload && includesPlaintextLinkFields) {
      return {
        status: 'invalid',
        opId
      };
    }

    const parentId = parseIdentifierWithCompactFallback(
      value['parentId'],
      value['parentIdBytes']
    );
    const rawChildId = parseIdentifierWithCompactFallback(
      value['childId'],
      value['childIdBytes']
    );
    const shouldRequirePlaintextLinkFields = !hasEncryptedPayload;
    const childId = shouldRequirePlaintextLinkFields
      ? (rawChildId ?? itemId)
      : rawChildId;
    if (shouldRequirePlaintextLinkFields && (!parentId || !childId)) {
      return {
        status: 'invalid',
        opId
      };
    }

    /**
     * Guardrail: link operations target a single child item id. Any payload
     * that mismatches `itemId`/`childId` or self-links must be rejected at
     * API ingress so malformed graph mutations never enter canonical feed
     * ordering.
     */
    if (
      (parentId !== null || childId !== null) &&
      (!parentId || !childId || childId !== itemId || parentId === childId)
    ) {
      return {
        status: 'invalid',
        opId
      };
    }

    if (parentId !== null) {
      operation.parentId = parentId;
    }
    if (childId !== null) {
      operation.childId = childId;
    }
  }

  if (opType === 'item_upsert' || opType === 'item_delete') {
    const includesAclFields =
      Object.hasOwn(value, 'principalType') ||
      Object.hasOwn(value, 'principalId') ||
      Object.hasOwn(value, 'accessLevel') ||
      hasCompactEnumField(value, 'principalTypeEnum') ||
      hasCompactBytesField(value, 'principalIdBytes') ||
      hasCompactEnumField(value, 'accessLevelEnum');
    const includesLinkFields =
      Object.hasOwn(value, 'parentId') ||
      Object.hasOwn(value, 'childId') ||
      hasCompactBytesField(value, 'parentIdBytes') ||
      hasCompactBytesField(value, 'childIdBytes');

    if (includesAclFields || includesLinkFields) {
      return {
        status: 'invalid',
        opId
      };
    }

    if (opType === 'item_upsert' && !hasEncryptedPayload) {
      return {
        status: 'invalid',
        opId
      };
    }

    if (opType === 'item_delete' && hasEncryptedPayload) {
      return {
        status: 'invalid',
        opId
      };
    }
  }

  return {
    status: 'parsed',
    opId,
    operation
  };
}

export function parsePushPayload(body: unknown): ParsePushPayloadResult {
  if (!isRecord(body)) {
    return {
      ok: false,
      error: 'clientId and operations are required'
    };
  }

  const clientId = parseClientId(body['clientId'], body['clientIdBytes']);
  if (!clientId) {
    return {
      ok: false,
      error: 'clientId must be non-empty, <=128 chars, and must not contain ":"'
    };
  }

  const rawOperations = body['operations'];
  if (!Array.isArray(rawOperations)) {
    return {
      ok: false,
      error: 'operations must be an array'
    };
  }

  if (rawOperations.length > MAX_PUSH_OPERATIONS) {
    return {
      ok: false,
      error: `operations exceeds max entries (${MAX_PUSH_OPERATIONS})`
    };
  }

  const operations = rawOperations.map((entry, index) =>
    parsePushOperation(entry, index, clientId)
  );

  return {
    ok: true,
    value: {
      clientId,
      operations
    }
  };
}
