import type {
  VfsAclAccessLevel,
  VfsAclPrincipalType,
  VfsCrdtOpType,
  VfsCrdtPushStatus
} from '@tearleads/shared';

const CONNECT_JSON_OP_TYPE_MAP: Record<string, VfsCrdtOpType> = {
  VFS_CRDT_OP_TYPE_ACL_ADD: 'acl_add',
  VFS_CRDT_OP_TYPE_ACL_REMOVE: 'acl_remove',
  VFS_CRDT_OP_TYPE_LINK_ADD: 'link_add',
  VFS_CRDT_OP_TYPE_LINK_REMOVE: 'link_remove',
  VFS_CRDT_OP_TYPE_LINK_REASSIGN: 'link_reassign',
  VFS_CRDT_OP_TYPE_ITEM_UPSERT: 'item_upsert',
  VFS_CRDT_OP_TYPE_ITEM_DELETE: 'item_delete'
};

const CONNECT_JSON_PRINCIPAL_TYPE_MAP: Record<string, VfsAclPrincipalType> = {
  VFS_ACL_PRINCIPAL_TYPE_USER: 'user',
  VFS_ACL_PRINCIPAL_TYPE_GROUP: 'group',
  VFS_ACL_PRINCIPAL_TYPE_ORGANIZATION: 'organization'
};

const CONNECT_JSON_ACCESS_LEVEL_MAP: Record<string, VfsAclAccessLevel> = {
  VFS_ACL_ACCESS_LEVEL_READ: 'read',
  VFS_ACL_ACCESS_LEVEL_WRITE: 'write',
  VFS_ACL_ACCESS_LEVEL_ADMIN: 'admin'
};

const CONNECT_JSON_PUSH_STATUS_MAP: Record<string, VfsCrdtPushStatus> = {
  VFS_CRDT_PUSH_STATUS_APPLIED: 'applied',
  VFS_CRDT_PUSH_STATUS_ALREADY_APPLIED: 'alreadyApplied',
  VFS_CRDT_PUSH_STATUS_STALE_WRITE_ID: 'staleWriteId',
  VFS_CRDT_PUSH_STATUS_OUTDATED_OP: 'outdatedOp',
  VFS_CRDT_PUSH_STATUS_INVALID_OP: 'invalidOp',
  VFS_CRDT_PUSH_STATUS_ACL_DENIED: 'aclDenied',
  VFS_CRDT_PUSH_STATUS_ENCRYPTED_ENVELOPE_UNSUPPORTED:
    'encryptedEnvelopeUnsupported'
};

const CONNECT_JSON_OP_TYPE_BY_DOMAIN: Record<VfsCrdtOpType, string> = {
  acl_add: 'VFS_CRDT_OP_TYPE_ACL_ADD',
  acl_remove: 'VFS_CRDT_OP_TYPE_ACL_REMOVE',
  link_add: 'VFS_CRDT_OP_TYPE_LINK_ADD',
  link_remove: 'VFS_CRDT_OP_TYPE_LINK_REMOVE',
  link_reassign: 'VFS_CRDT_OP_TYPE_LINK_REASSIGN',
  item_upsert: 'VFS_CRDT_OP_TYPE_ITEM_UPSERT',
  item_delete: 'VFS_CRDT_OP_TYPE_ITEM_DELETE'
};

const CONNECT_JSON_PRINCIPAL_TYPE_BY_DOMAIN: Record<
  VfsAclPrincipalType,
  string
> = {
  user: 'VFS_ACL_PRINCIPAL_TYPE_USER',
  group: 'VFS_ACL_PRINCIPAL_TYPE_GROUP',
  organization: 'VFS_ACL_PRINCIPAL_TYPE_ORGANIZATION'
};

const CONNECT_JSON_ACCESS_LEVEL_BY_DOMAIN: Record<VfsAclAccessLevel, string> = {
  read: 'VFS_ACL_ACCESS_LEVEL_READ',
  write: 'VFS_ACL_ACCESS_LEVEL_WRITE',
  admin: 'VFS_ACL_ACCESS_LEVEL_ADMIN'
};

const CONNECT_JSON_PUSH_STATUS_BY_DOMAIN: Record<VfsCrdtPushStatus, string> = {
  applied: 'VFS_CRDT_PUSH_STATUS_APPLIED',
  alreadyApplied: 'VFS_CRDT_PUSH_STATUS_ALREADY_APPLIED',
  staleWriteId: 'VFS_CRDT_PUSH_STATUS_STALE_WRITE_ID',
  outdatedOp: 'VFS_CRDT_PUSH_STATUS_OUTDATED_OP',
  invalidOp: 'VFS_CRDT_PUSH_STATUS_INVALID_OP',
  aclDenied: 'VFS_CRDT_PUSH_STATUS_ACL_DENIED',
  encryptedEnvelopeUnsupported:
    'VFS_CRDT_PUSH_STATUS_ENCRYPTED_ENVELOPE_UNSUPPORTED'
};

function normalizeOpType(value: unknown): VfsCrdtOpType | null {
  if (typeof value !== 'string') {
    return null;
  }
  return CONNECT_JSON_OP_TYPE_MAP[value.trim()] ?? null;
}

function normalizePrincipalType(value: unknown): VfsAclPrincipalType | null {
  if (typeof value !== 'string') {
    return null;
  }
  return CONNECT_JSON_PRINCIPAL_TYPE_MAP[value.trim()] ?? null;
}

function normalizeAccessLevel(value: unknown): VfsAclAccessLevel | null {
  if (typeof value !== 'string') {
    return null;
  }
  return CONNECT_JSON_ACCESS_LEVEL_MAP[value.trim()] ?? null;
}

function normalizePushStatus(value: unknown): VfsCrdtPushStatus | null {
  if (typeof value !== 'string') {
    return null;
  }
  return CONNECT_JSON_PUSH_STATUS_MAP[value.trim()] ?? null;
}

export function encodeConnectJsonOpType(value: VfsCrdtOpType): string {
  return CONNECT_JSON_OP_TYPE_BY_DOMAIN[value];
}

export function encodeConnectJsonPrincipalType(
  value: VfsAclPrincipalType
): string {
  return CONNECT_JSON_PRINCIPAL_TYPE_BY_DOMAIN[value];
}

export function encodeConnectJsonAccessLevel(value: VfsAclAccessLevel): string {
  return CONNECT_JSON_ACCESS_LEVEL_BY_DOMAIN[value];
}

export function encodeConnectJsonPushStatus(value: VfsCrdtPushStatus): string {
  return CONNECT_JSON_PUSH_STATUS_BY_DOMAIN[value];
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
