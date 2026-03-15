export const OP_TYPE_MAP: Record<string, number> = {
  acl_add: 1,
  acl_remove: 2,
  link_add: 3,
  link_remove: 4,
  item_upsert: 5,
  item_delete: 6,
  link_reassign: 7
};

export const PROTOBUF_OP_TYPE_MAP: Record<string, string> = {
  ACL_ADD: 'acl_add',
  ACL_REMOVE: 'acl_remove',
  LINK_ADD: 'link_add',
  LINK_REMOVE: 'link_remove',
  ITEM_UPSERT: 'item_upsert',
  ITEM_DELETE: 'item_delete',
  LINK_REASSIGN: 'link_reassign'
};

export const PRINCIPAL_TYPE_MAP: Record<string, number> = {
  user: 1,
  group: 2,
  organization: 3
};

export const PROTOBUF_PRINCIPAL_TYPE_MAP: Record<string, string> = {
  USER: 'user',
  GROUP: 'group',
  ORGANIZATION: 'organization'
};

export const ACCESS_LEVEL_MAP: Record<string, number> = {
  read: 1,
  write: 2,
  admin: 3
};

export const PROTOBUF_ACCESS_LEVEL_MAP: Record<string, string> = {
  READ: 'read',
  WRITE: 'write',
  ADMIN: 'admin'
};

export const PUSH_STATUS_MAP: Record<string, number> = {
  applied: 1,
  staleWriteId: 2,
  outdatedOp: 3,
  invalidOp: 4,
  alreadyApplied: 5,
  encryptedEnvelopeUnsupported: 6,
  aclDenied: 7
};

export const PROTOBUF_PUSH_STATUS_MAP: Record<string, string> = {
  APPLIED: 'applied',
  STALE_WRITE_ID: 'staleWriteId',
  OUTDATED_OP: 'outdatedOp',
  INVALID_OP: 'invalidOp',
  ALREADY_APPLIED: 'alreadyApplied',
  ENCRYPTED_ENVELOPE_UNSUPPORTED: 'encryptedEnvelopeUnsupported',
  ACL_DENIED: 'aclDenied'
};
