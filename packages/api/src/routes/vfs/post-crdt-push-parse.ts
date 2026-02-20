import type {
  VfsAclAccessLevel,
  VfsAclPrincipalType,
  VfsCrdtOpType,
  VfsCrdtPushOperation
} from '@tearleads/shared';
import { isRecord } from '@tearleads/shared';

const MAX_CLIENT_ID_LENGTH = 128;
const MAX_PUSH_OPERATIONS = 500;

const VALID_OP_TYPES: VfsCrdtOpType[] = [
  'acl_add',
  'acl_remove',
  'link_add',
  'link_remove'
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

export type ParsePushPayloadResult =
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

function normalizeWriteId(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return null;
  }

  if (
    !Number.isInteger(value) ||
    value < 1 ||
    value > Number.MAX_SAFE_INTEGER
  ) {
    return null;
  }

  return value;
}

function normalizeOccurredAt(value: unknown): string | null {
  const normalized = normalizeRequiredString(value);
  if (!normalized) {
    return null;
  }

  const parsedMs = Date.parse(normalized);
  if (!Number.isFinite(parsedMs)) {
    return null;
  }

  return new Date(parsedMs).toISOString();
}

function parseClientId(value: unknown): string | null {
  const normalized = normalizeRequiredString(value);
  if (!normalized) {
    return null;
  }

  if (normalized.length > MAX_CLIENT_ID_LENGTH || normalized.includes(':')) {
    return null;
  }

  return normalized;
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

  const opId = normalizeRequiredString(value['opId']) ?? `invalid-${index}`;
  const opType = value['opType'];
  const itemId = normalizeRequiredString(value['itemId']);
  const replicaId = parseClientId(value['replicaId']);
  const writeId = normalizeWriteId(value['writeId']);
  const occurredAt = normalizeOccurredAt(value['occurredAt']);

  if (
    !isValidOpType(opType) ||
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
    if (typeof keyEpoch !== 'number' || keyEpoch < 1) {
      return {
        status: 'invalid',
        opId
      };
    }

    operation.encryptedPayload = encryptedPayload;
    operation.keyEpoch = keyEpoch;

    // Optional encryption metadata
    const encryptionNonce = normalizeRequiredString(value['encryptionNonce']);
    if (encryptionNonce) {
      operation.encryptionNonce = encryptionNonce;
    }

    const encryptionAad = normalizeRequiredString(value['encryptionAad']);
    if (encryptionAad) {
      operation.encryptionAad = encryptionAad;
    }

    const encryptionSignature = normalizeRequiredString(
      value['encryptionSignature']
    );
    if (encryptionSignature) {
      operation.encryptionSignature = encryptionSignature;
    }
  }

  if (opType === 'acl_add' || opType === 'acl_remove') {
    const principalType = value['principalType'];
    const principalId = normalizeRequiredString(value['principalId']);

    // With encrypted payload, plaintext ACL fields are optional
    // (the actual ACL data is in the encrypted envelope)
    if (!hasEncryptedPayload) {
      if (!isValidPrincipalType(principalType) || !principalId) {
        return {
          status: 'invalid',
          opId
        };
      }
    }

    // Store plaintext fields if provided (allows hybrid encrypted+plaintext operations)
    if (isValidPrincipalType(principalType)) {
      operation.principalType = principalType;
    }
    if (principalId) {
      operation.principalId = principalId;
    }

    if (opType === 'acl_add') {
      const accessLevel = value['accessLevel'];
      if (!hasEncryptedPayload && !isValidAccessLevel(accessLevel)) {
        return {
          status: 'invalid',
          opId
        };
      }

      if (isValidAccessLevel(accessLevel)) {
        operation.accessLevel = accessLevel;
      }
    }
  }

  if (opType === 'link_add' || opType === 'link_remove') {
    const parentId = normalizeRequiredString(value['parentId']);
    const childId = normalizeRequiredString(value['childId']) ?? itemId;
    if (!parentId || !childId) {
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
    if (childId !== itemId || parentId === childId) {
      return {
        status: 'invalid',
        opId
      };
    }

    operation.parentId = parentId;
    operation.childId = childId;
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

  const clientId = parseClientId(body['clientId']);
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
