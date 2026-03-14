import type {
  VfsAclAccessLevel,
  VfsAclPrincipalType,
  VfsCrdtOpType,
  VfsCrdtPushOperation
} from '@tearleads/shared';
import { isRecord } from '@tearleads/shared';
import {
  parseIdentifier,
  parseInteger
} from './vfsDirectCrdtCompactDecoding.js';

const MAX_CLIENT_ID_LENGTH = 128;
const MAX_PUSH_OPERATIONS = 500;

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

function parseEnum<T extends string>(
  value: unknown,
  validValues: T[]
): T | null {
  if (typeof value !== 'string') {
    return null;
  }

  for (const candidate of validValues) {
    if (candidate === value) {
      return candidate;
    }
  }

  return null;
}

function parseOccurredAt(value: unknown): string | null {
  const occurredAt = normalizeRequiredString(value);
  if (!occurredAt) {
    return null;
  }

  const parsedMs = Date.parse(occurredAt);
  if (!Number.isFinite(parsedMs) || parsedMs < 0) {
    return null;
  }

  return new Date(parsedMs).toISOString();
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

  const opId = parseIdentifier(value['opId']) ?? `invalid-${index}`;
  const opType = parseEnum(value['opType'], VALID_OP_TYPES);
  const itemId = parseIdentifier(value['itemId']);
  const replicaId = parseIdentifier(value['replicaId']);
  const writeId = parseInteger(value['writeId']);
  const occurredAt = parseOccurredAt(value['occurredAt']);

  if (
    !opType ||
    !itemId ||
    !replicaId ||
    writeId === null ||
    writeId < 1 ||
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

  const encryptedPayload = normalizeRequiredString(value['encryptedPayload']);
  const hasEncryptedPayload = encryptedPayload !== null;
  if (hasEncryptedPayload) {
    const keyEpoch = parseInteger(value['keyEpoch']);
    if (keyEpoch === null || keyEpoch < 1) {
      return { status: 'invalid', opId };
    }

    const encryptionNonce = normalizeRequiredString(value['encryptionNonce']);
    const encryptionAad = normalizeRequiredString(value['encryptionAad']);
    const encryptionSignature = normalizeRequiredString(
      value['encryptionSignature']
    );
    if (!encryptionNonce || !encryptionAad || !encryptionSignature) {
      return { status: 'invalid', opId };
    }

    operation.encryptedPayload = encryptedPayload;
    operation.keyEpoch = keyEpoch;
    operation.encryptionNonce = encryptionNonce;
    operation.encryptionAad = encryptionAad;
    operation.encryptionSignature = encryptionSignature;
  }

  const operationSignature = normalizeRequiredString(
    value['operationSignature']
  );
  if (operationSignature) {
    operation.operationSignature = operationSignature;
  }

  if (opType === 'acl_add' || opType === 'acl_remove') {
    const includesPlaintextAclFields =
      Object.hasOwn(value, 'principalType') ||
      Object.hasOwn(value, 'principalId') ||
      Object.hasOwn(value, 'accessLevel');
    if (hasEncryptedPayload && includesPlaintextAclFields) {
      return { status: 'invalid', opId };
    }

    const principalType = parseEnum(
      value['principalType'],
      VALID_PRINCIPAL_TYPES
    );
    const principalId = parseIdentifier(value['principalId']);

    if (!hasEncryptedPayload && (!principalType || !principalId)) {
      return { status: 'invalid', opId };
    }

    if (principalType) operation.principalType = principalType;
    if (principalId) operation.principalId = principalId;

    if (opType === 'acl_add') {
      const accessLevel = parseEnum(value['accessLevel'], VALID_ACCESS_LEVELS);
      if (!hasEncryptedPayload && !accessLevel) {
        return { status: 'invalid', opId };
      }
      if (accessLevel) operation.accessLevel = accessLevel;
    } else if (Object.hasOwn(value, 'accessLevel')) {
      return { status: 'invalid', opId };
    }
  }

  if (
    opType === 'link_add' ||
    opType === 'link_remove' ||
    opType === 'link_reassign'
  ) {
    const includesPlaintextLinkFields =
      Object.hasOwn(value, 'parentId') || Object.hasOwn(value, 'childId');
    if (hasEncryptedPayload && includesPlaintextLinkFields) {
      return { status: 'invalid', opId };
    }

    const parentId = parseIdentifier(value['parentId']);
    const rawChildId = parseIdentifier(value['childId']);
    const childId = hasEncryptedPayload ? rawChildId : (rawChildId ?? itemId);

    if (!hasEncryptedPayload && (!parentId || !childId)) {
      return { status: 'invalid', opId };
    }

    if (
      (parentId !== null || childId !== null) &&
      (!parentId || !childId || childId !== itemId || parentId === childId)
    ) {
      return { status: 'invalid', opId };
    }

    if (parentId) operation.parentId = parentId;
    if (childId) operation.childId = childId;
  }

  if (opType === 'item_upsert' || opType === 'item_delete') {
    const includesAclFields =
      Object.hasOwn(value, 'principalType') ||
      Object.hasOwn(value, 'principalId') ||
      Object.hasOwn(value, 'accessLevel');
    const includesLinkFields =
      Object.hasOwn(value, 'parentId') || Object.hasOwn(value, 'childId');

    if (includesAclFields || includesLinkFields) {
      return { status: 'invalid', opId };
    }

    if (opType === 'item_upsert' && !hasEncryptedPayload) {
      return { status: 'invalid', opId };
    }

    if (opType === 'item_delete' && hasEncryptedPayload) {
      return { status: 'invalid', opId };
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

  const clientId = parseIdentifier(body['clientId']);
  if (
    !clientId ||
    clientId.length > MAX_CLIENT_ID_LENGTH ||
    clientId.includes(':')
  ) {
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
