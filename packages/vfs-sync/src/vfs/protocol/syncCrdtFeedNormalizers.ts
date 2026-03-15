import type {
  VfsAclAccessLevel,
  VfsAclPrincipalType,
  VfsCrdtOpType
} from '@tearleads/shared';

const VALID_ACCESS_LEVELS: VfsAclAccessLevel[] = ['read', 'write', 'admin'];
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

export function parseOccurredAtMs(value: Date | string): number | null {
  if (value instanceof Date) {
    const asMs = value.getTime();
    return Number.isFinite(asMs) ? asMs : null;
  }

  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) {
    return null;
  }

  return parsed;
}

export function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

export function normalizeNonEmptyString(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function toIsoString(value: Date | string): string | null {
  if (value instanceof Date) {
    return value.toISOString();
  }

  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) {
    return null;
  }

  return new Date(parsed).toISOString();
}

export function normalizeAccessLevel(value: unknown): VfsAclAccessLevel | null {
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

export function normalizePositiveInteger(value: unknown): number | null {
  if (typeof value === 'number') {
    if (
      Number.isFinite(value) &&
      Number.isInteger(value) &&
      value >= 1 &&
      value <= Number.MAX_SAFE_INTEGER
    ) {
      return value;
    }
    return null;
  }

  if (typeof value === 'string') {
    const parsed = Number.parseInt(value, 10);
    if (
      Number.isFinite(parsed) &&
      Number.isInteger(parsed) &&
      parsed >= 1 &&
      parsed <= Number.MAX_SAFE_INTEGER
    ) {
      return parsed;
    }
  }

  return null;
}

export function normalizeBlobSizeBytes(value: unknown): number | null {
  if (value === undefined || value === null) return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  const parsed = Number.parseInt(String(value), 10);
  return !Number.isNaN(parsed) ? parsed : null;
}

export function normalizeOpType(value: unknown): VfsCrdtOpType {
  if (typeof value === 'string') {
    for (const opType of VALID_OP_TYPES) {
      if (opType === value) {
        return opType;
      }
    }
  }

  return 'acl_add';
}

export function normalizePrincipalType(
  value: unknown
): VfsAclPrincipalType | null {
  if (typeof value === 'string') {
    for (const principalType of VALID_PRINCIPAL_TYPES) {
      if (principalType === value) {
        return principalType;
      }
    }
  }

  return null;
}
