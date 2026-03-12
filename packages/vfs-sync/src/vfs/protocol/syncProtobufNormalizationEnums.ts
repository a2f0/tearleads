export const OP_TYPE_MAP: Record<string, number> = {
  acl_add: 1,
  acl_remove: 2,
  link_add: 3,
  link_remove: 4,
  item_upsert: 5,
  item_delete: 6,
  ACL_ADD: 1,
  ACL_REMOVE: 2,
  LINK_ADD: 3,
  LINK_REMOVE: 4,
  ITEM_UPSERT: 5,
  ITEM_DELETE: 6
};

export const REV_OP_TYPE_MAP: Record<number, string> = {
  1: 'acl_add',
  2: 'acl_remove',
  3: 'link_add',
  4: 'link_remove',
  5: 'item_upsert',
  6: 'item_delete'
};

export const PRINCIPAL_TYPE_MAP: Record<string, number> = {
  user: 1,
  group: 2,
  organization: 3,
  USER: 1,
  GROUP: 2,
  ORGANIZATION: 3
};

export const REV_PRINCIPAL_TYPE_MAP: Record<number, string> = {
  1: 'user',
  2: 'group',
  3: 'organization'
};

export const ACCESS_LEVEL_MAP: Record<string, number> = {
  read: 1,
  write: 2,
  admin: 3,
  READ: 1,
  WRITE: 2,
  ADMIN: 3
};

export const REV_ACCESS_LEVEL_MAP: Record<number, string> = {
  1: 'read',
  2: 'write',
  3: 'admin'
};

export const PUSH_STATUS_MAP: Record<string, number> = {
  applied: 1,
  staleWriteId: 2,
  outdatedOp: 3,
  invalidOp: 4,
  alreadyApplied: 5,
  encryptedEnvelopeUnsupported: 6,
  APPLIED: 1,
  STALE_WRITE_ID: 2,
  OUTDATED_OP: 3,
  INVALID_OP: 4,
  ALREADY_APPLIED: 5,
  ENCRYPTED_ENVELOPE_UNSUPPORTED: 6
};

export const REV_PUSH_STATUS_MAP: Record<number, string> = {
  1: 'applied',
  2: 'staleWriteId',
  3: 'outdatedOp',
  4: 'invalidOp',
  5: 'alreadyApplied',
  6: 'encryptedEnvelopeUnsupported'
};
