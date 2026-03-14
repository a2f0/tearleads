import type {
  VfsAclAccessLevel,
  VfsAclPrincipalType,
  VfsCrdtOpType,
  VfsCrdtPushStatus
} from '@tearleads/shared';

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
const VALID_PUSH_STATUSES: VfsCrdtPushStatus[] = [
  'applied',
  'alreadyApplied',
  'staleWriteId',
  'outdatedOp',
  'invalidOp',
  'aclDenied',
  'encryptedEnvelopeUnsupported'
];

function normalizeOpType(value: unknown): VfsCrdtOpType | null {
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

  if (typeof value !== 'string') {
    return null;
  }

  for (const candidate of VALID_OP_TYPES) {
    if (candidate === value) {
      return candidate;
    }
  }

  switch (value.trim().toUpperCase()) {
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

  if (typeof value !== 'string') {
    return null;
  }

  for (const candidate of VALID_PRINCIPAL_TYPES) {
    if (candidate === value) {
      return candidate;
    }
  }

  switch (value.trim().toUpperCase()) {
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

  if (typeof value !== 'string') {
    return null;
  }

  for (const candidate of VALID_ACCESS_LEVELS) {
    if (candidate === value) {
      return candidate;
    }
  }

  switch (value.trim().toUpperCase()) {
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

function normalizePushStatus(value: unknown): VfsCrdtPushStatus | null {
  if (typeof value === 'number') {
    switch (value) {
      case 1:
        return 'applied';
      case 2:
        return 'alreadyApplied';
      case 3:
        return 'staleWriteId';
      case 4:
        return 'outdatedOp';
      case 5:
        return 'invalidOp';
      case 6:
        return 'aclDenied';
      case 7:
        return 'encryptedEnvelopeUnsupported';
      default:
        return null;
    }
  }

  if (typeof value !== 'string') {
    return null;
  }

  for (const candidate of VALID_PUSH_STATUSES) {
    if (candidate === value) {
      return candidate;
    }
  }

  switch (value.trim().toUpperCase()) {
    case 'APPLIED':
    case 'VFS_CRDT_PUSH_STATUS_APPLIED':
      return 'applied';
    case 'ALREADYAPPLIED':
    case 'ALREADY_APPLIED':
    case 'VFS_CRDT_PUSH_STATUS_ALREADY_APPLIED':
      return 'alreadyApplied';
    case 'STALEWRITEID':
    case 'STALE_WRITE_ID':
    case 'VFS_CRDT_PUSH_STATUS_STALE_WRITE_ID':
      return 'staleWriteId';
    case 'OUTDATEDOP':
    case 'OUTDATED_OP':
    case 'VFS_CRDT_PUSH_STATUS_OUTDATED_OP':
      return 'outdatedOp';
    case 'INVALIDOP':
    case 'INVALID_OP':
    case 'VFS_CRDT_PUSH_STATUS_INVALID_OP':
      return 'invalidOp';
    case 'ACLDENIED':
    case 'ACL_DENIED':
    case 'VFS_CRDT_PUSH_STATUS_ACL_DENIED':
      return 'aclDenied';
    case 'ENCRYPTEDENVELOPEUNSUPPORTED':
    case 'ENCRYPTED_ENVELOPE_UNSUPPORTED':
    case 'VFS_CRDT_PUSH_STATUS_ENCRYPTED_ENVELOPE_UNSUPPORTED':
      return 'encryptedEnvelopeUnsupported';
    default:
      return null;
  }
}

export function parseOpType(value: unknown, fieldName: string): VfsCrdtOpType {
  const normalized = normalizeOpType(value);
  if (!normalized) {
    throw new Error(`transport returned invalid ${fieldName}`);
  }

  return normalized;
}

export function parseNullablePrincipalType(
  value: unknown,
  fieldName: string
): VfsAclPrincipalType | null {
  if (
    value === null ||
    value === undefined ||
    (typeof value === 'string' && value.trim().length === 0)
  ) {
    return null;
  }

  const normalized = normalizePrincipalType(value);
  if (!normalized) {
    throw new Error(`transport returned invalid ${fieldName}`);
  }

  return normalized;
}

export function parseNullableAccessLevel(
  value: unknown,
  fieldName: string
): VfsAclAccessLevel | null {
  if (
    value === null ||
    value === undefined ||
    (typeof value === 'string' && value.trim().length === 0)
  ) {
    return null;
  }

  const normalized = normalizeAccessLevel(value);
  if (!normalized) {
    throw new Error(`transport returned invalid ${fieldName}`);
  }

  return normalized;
}

export function parsePushStatus(
  value: unknown,
  fieldName: string
): VfsCrdtPushStatus {
  const normalized = normalizePushStatus(value);
  if (!normalized) {
    throw new Error(`transport returned invalid ${fieldName}`);
  }

  return normalized;
}
