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
  if (typeof value === 'string') {
    if (validValues.includes(value as T)) {
      return value as T;
    }
  }
  return null;
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
  const occurredAtMs = parseInteger(value['occurredAtMs']);

  if (
    !opType ||
    !itemId ||
    !replicaId ||
    !writeId ||
    occurredAtMs === null ||
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
    occurredAt: new Date(occurredAtMs).toISOString()
  };

  const encryptedPayload = normalizeRequiredString(value['encryptedPayload']);
  if (encryptedPayload !== null) {
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

  if (opType === 'acl_add' || opType === 'acl_remove') {
    const principalType = parseEnum(value['principalType'], VALID_PRINCIPAL_TYPES);
    const principalId = parseIdentifier(value['principalId']);

    if (principalType) operation.principalType = principalType;
    if (principalId) operation.principalId = principalId;

    if (opType === 'acl_add') {
      const accessLevel = parseEnum(value['accessLevel'], VALID_ACCESS_LEVELS);
      if (accessLevel) operation.accessLevel = accessLevel;
    }
  }

  if (
    opType === 'link_add' ||
    opType === 'link_remove' ||
    opType === 'link_reassign'
  ) {
    const parentId = parseIdentifier(value['parentId']);
    const childId = parseIdentifier(value['childId']);

    if (parentId) operation.parentId = parentId;
    if (childId) operation.childId = childId;
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
  if (!clientId || clientId.length > MAX_CLIENT_ID_LENGTH || clientId.includes(':')) {
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
