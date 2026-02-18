import type { VfsAclAccessLevel, VfsAclPrincipalType } from '@tearleads/shared';
import type { VfsCrdtOperation } from './sync-crdt-types.js';

export interface ParsedStamp {
  replicaId: string;
  writeId: number;
  occurredAt: string;
  occurredAtMs: number;
  opId: string;
}

export type PreparedOperation =
  | {
      kind: 'acl';
      key: string;
      itemId: string;
      principalType: VfsAclPrincipalType;
      principalId: string;
      accessLevel: VfsAclAccessLevel | null;
      stamp: ParsedStamp;
    }
  | {
      kind: 'link';
      key: string;
      parentId: string;
      childId: string;
      present: boolean;
      stamp: ParsedStamp;
    };

const VALID_ACCESS_LEVELS: VfsAclAccessLevel[] = ['read', 'write', 'admin'];
const VALID_PRINCIPAL_TYPES: VfsAclPrincipalType[] = [
  'user',
  'group',
  'organization'
];

function normalizeNonEmptyString(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function normalizeWriteId(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return null;
  }

  if (!Number.isInteger(value) || value < 1) {
    return null;
  }

  return value;
}

function normalizeAccessLevel(value: unknown): VfsAclAccessLevel | null {
  if (typeof value !== 'string') {
    return null;
  }

  for (const accessLevel of VALID_ACCESS_LEVELS) {
    if (accessLevel === value) {
      return accessLevel;
    }
  }

  return null;
}

function normalizePrincipalType(value: unknown): VfsAclPrincipalType | null {
  if (typeof value !== 'string') {
    return null;
  }

  for (const principalType of VALID_PRINCIPAL_TYPES) {
    if (principalType === value) {
      return principalType;
    }
  }

  return null;
}

function parseStamp(operation: VfsCrdtOperation): ParsedStamp | null {
  const opId = normalizeNonEmptyString(operation.opId);
  const replicaId = normalizeNonEmptyString(operation.replicaId);
  const writeId = normalizeWriteId(operation.writeId);
  const occurredAt = normalizeNonEmptyString(operation.occurredAt);

  if (!opId || !replicaId || writeId === null || !occurredAt) {
    return null;
  }

  const occurredAtMs = Date.parse(occurredAt);
  if (!Number.isFinite(occurredAtMs)) {
    return null;
  }

  return {
    opId,
    replicaId,
    writeId,
    occurredAt,
    occurredAtMs
  };
}

export function compareParsedStamps(
  left: ParsedStamp,
  right: ParsedStamp
): number {
  if (left.replicaId === right.replicaId) {
    if (left.writeId < right.writeId) {
      return -1;
    }
    if (left.writeId > right.writeId) {
      return 1;
    }
  }

  if (left.occurredAtMs < right.occurredAtMs) {
    return -1;
  }
  if (left.occurredAtMs > right.occurredAtMs) {
    return 1;
  }

  if (left.opId < right.opId) {
    return -1;
  }
  if (left.opId > right.opId) {
    return 1;
  }

  if (left.replicaId < right.replicaId) {
    return -1;
  }
  if (left.replicaId > right.replicaId) {
    return 1;
  }

  if (left.writeId < right.writeId) {
    return -1;
  }
  if (left.writeId > right.writeId) {
    return 1;
  }

  return 0;
}

export function compareFeedOrder(
  left: ParsedStamp,
  right: ParsedStamp
): number {
  if (left.occurredAtMs < right.occurredAtMs) {
    return -1;
  }

  if (left.occurredAtMs > right.occurredAtMs) {
    return 1;
  }

  if (left.opId < right.opId) {
    return -1;
  }

  if (left.opId > right.opId) {
    return 1;
  }

  return 0;
}

function toAclKey(
  itemId: string,
  principalType: VfsAclPrincipalType,
  principalId: string
): string {
  return `${itemId}:${principalType}:${principalId}`;
}

function toLinkKey(parentId: string, childId: string): string {
  return `${parentId}:${childId}`;
}

export function prepareOperation(
  operation: VfsCrdtOperation
): PreparedOperation | null {
  const stamp = parseStamp(operation);
  const itemId = normalizeNonEmptyString(operation.itemId);

  if (!stamp || !itemId) {
    return null;
  }

  if (operation.opType === 'acl_add' || operation.opType === 'acl_remove') {
    const principalType = normalizePrincipalType(operation.principalType);
    const principalId = normalizeNonEmptyString(operation.principalId);
    if (!principalType || !principalId) {
      return null;
    }

    if (operation.opType === 'acl_add') {
      const accessLevel = normalizeAccessLevel(operation.accessLevel);
      if (!accessLevel) {
        return null;
      }

      return {
        kind: 'acl',
        key: toAclKey(itemId, principalType, principalId),
        itemId,
        principalType,
        principalId,
        accessLevel,
        stamp
      };
    }

    return {
      kind: 'acl',
      key: toAclKey(itemId, principalType, principalId),
      itemId,
      principalType,
      principalId,
      accessLevel: null,
      stamp
    };
  }

  if (operation.opType === 'link_add' || operation.opType === 'link_remove') {
    const parentId = normalizeNonEmptyString(operation.parentId);
    const childId = normalizeNonEmptyString(operation.childId) ?? itemId;
    if (!parentId || !childId) {
      return null;
    }
    if (childId !== itemId) {
      /**
       * Guardrail: link operations are item-scoped and must not carry a
       * mismatched childId payload for a different item.
       */
      return null;
    }
    if (parentId === childId) {
      /**
       * Guardrail: self-referential links create immediate cycles and are
       * rejected at CRDT normalization so they cannot enter canonical state.
       */
      return null;
    }

    return {
      kind: 'link',
      key: toLinkKey(parentId, childId),
      parentId,
      childId,
      present: operation.opType === 'link_add',
      stamp
    };
  }

  return null;
}
