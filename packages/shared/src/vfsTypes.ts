// VFS types
export interface VfsUserKeysResponse {
  publicEncryptionKey: string;
  publicSigningKey: string;
  encryptedPrivateKeys?: string;
  argon2Salt?: string;
}

export interface VfsKeySetupRequest {
  publicEncryptionKey: string;
  publicSigningKey?: string; // Optional for now, not yet implemented
  encryptedPrivateKeys: string;
  argon2Salt: string;
}

export type VfsObjectType =
  // Entities
  | 'file'
  | 'blob'
  | 'photo'
  | 'audio'
  | 'video'
  | 'contact'
  | 'note'
  | 'email'
  // Collections
  | 'folder'
  | 'playlist'
  | 'album'
  | 'contactGroup'
  | 'emailFolder'
  | 'tag';

export interface VfsRegisterRequest {
  id: string;
  objectType: VfsObjectType;
  encryptedSessionKey: string;
}

export interface VfsRegisterResponse {
  id: string;
  createdAt: string;
}

// VFS sync + ACL types
export type VfsAclPrincipalType = 'user' | 'group' | 'organization';
export type VfsAclAccessLevel = 'read' | 'write' | 'admin';
export type VfsSyncChangeType = 'upsert' | 'delete' | 'acl';

export interface VfsSyncItem {
  changeId: string;
  itemId: string;
  changeType: VfsSyncChangeType;
  changedAt: string;
  objectType: VfsObjectType | null;
  ownerId: string | null;
  createdAt: string | null;
  accessLevel: VfsAclAccessLevel;
}

export interface VfsSyncResponse {
  items: VfsSyncItem[];
  nextCursor: string | null;
  hasMore: boolean;
}

export interface VfsSyncReconcileRequest {
  clientId: string;
  cursor: string;
}

export interface VfsSyncReconcileResponse {
  clientId: string;
  cursor: string;
}

export type VfsCrdtOpType =
  | 'acl_add'
  | 'acl_remove'
  | 'link_add'
  | 'link_remove';

export interface VfsCrdtSyncItem {
  opId: string;
  itemId: string;
  opType: VfsCrdtOpType;
  principalType: VfsAclPrincipalType | null;
  principalId: string | null;
  accessLevel: VfsAclAccessLevel | null;
  parentId: string | null;
  childId: string | null;
  actorId: string | null;
  sourceTable: string;
  sourceId: string;
  occurredAt: string;
}

export interface VfsCrdtSyncResponse {
  items: VfsCrdtSyncItem[];
  nextCursor: string | null;
  hasMore: boolean;
  lastReconciledWriteIds: Record<string, number>;
}

export interface VfsCrdtReconcileRequest {
  clientId: string;
  cursor: string;
  lastReconciledWriteIds?: Record<string, number>;
}

export interface VfsCrdtReconcileResponse {
  clientId: string;
  cursor: string;
  lastReconciledWriteIds: Record<string, number>;
}

export interface VfsCrdtPushOperation {
  opId: string;
  opType: VfsCrdtOpType;
  itemId: string;
  replicaId: string;
  writeId: number;
  occurredAt: string;
  principalType?: VfsAclPrincipalType;
  principalId?: string;
  accessLevel?: VfsAclAccessLevel;
  parentId?: string;
  childId?: string;
}

export interface VfsCrdtPushRequest {
  clientId: string;
  operations: VfsCrdtPushOperation[];
}

export type VfsCrdtPushStatus =
  | 'applied'
  | 'alreadyApplied'
  | 'staleWriteId'
  | 'outdatedOp'
  | 'invalidOp';

export interface VfsCrdtPushResult {
  opId: string;
  status: VfsCrdtPushStatus;
}

export interface VfsCrdtPushResponse {
  clientId: string;
  results: VfsCrdtPushResult[];
}

// VFS Sharing types
export type VfsShareType = 'user' | 'group' | 'organization';
export type VfsPermissionLevel = 'view' | 'edit' | 'download';

export interface VfsShare {
  id: string;
  itemId: string;
  shareType: VfsShareType;
  targetId: string;
  targetName: string;
  permissionLevel: VfsPermissionLevel;
  createdBy: string;
  createdByEmail: string;
  createdAt: string;
  expiresAt: string | null;
}

export interface VfsOrgShare {
  id: string;
  sourceOrgId: string;
  sourceOrgName: string;
  targetOrgId: string;
  targetOrgName: string;
  itemId: string;
  permissionLevel: VfsPermissionLevel;
  createdBy: string;
  createdByEmail: string;
  createdAt: string;
  expiresAt: string | null;
}

export interface CreateVfsShareRequest {
  itemId: string;
  shareType: VfsShareType;
  targetId: string;
  permissionLevel: VfsPermissionLevel;
  expiresAt?: string | null;
}

export interface CreateOrgShareRequest {
  itemId: string;
  sourceOrgId: string;
  targetOrgId: string;
  permissionLevel: VfsPermissionLevel;
  expiresAt?: string | null;
}

export interface VfsSharesResponse {
  shares: VfsShare[];
  orgShares: VfsOrgShare[];
}

export interface UpdateVfsShareRequest {
  permissionLevel?: VfsPermissionLevel;
  expiresAt?: string | null;
}

export interface ShareTargetSearchResult {
  id: string;
  type: VfsShareType;
  name: string;
  description?: string | undefined;
}

export interface ShareTargetSearchResponse {
  results: ShareTargetSearchResult[];
}

/**
 * Item shared by the current user with others (outgoing share).
 * Includes the item details plus share metadata about who it was shared with.
 */
export interface VfsSharedByMeItem {
  id: string;
  objectType: VfsObjectType;
  name: string;
  createdAt: string;
  shareId: string;
  targetId: string;
  targetName: string;
  shareType: VfsShareType;
  permissionLevel: VfsPermissionLevel;
  sharedAt: string;
  expiresAt: string | null;
}

/**
 * Item shared with the current user by others (incoming share).
 * Includes the item details plus share metadata about who shared it.
 */
export interface VfsSharedWithMeItem {
  id: string;
  objectType: VfsObjectType;
  name: string;
  createdAt: string;
  shareId: string;
  sharedById: string;
  sharedByEmail: string;
  shareType: VfsShareType;
  permissionLevel: VfsPermissionLevel;
  sharedAt: string;
  expiresAt: string | null;
}

/**
 * Wrapped key payload for a single recipient.
 * Contains the encrypted session key and sender signature.
 */
export interface VfsWrappedKeyPayload {
  recipientUserId: string;
  recipientPublicKeyId: string;
  keyEpoch: number;
  encryptedKey: string;
  senderSignature: string;
}

/**
 * Request to rotate the encryption key for a VFS item.
 * Client generates the new epoch and wraps for all active recipients.
 */
export interface VfsRekeyRequest {
  reason: 'unshare' | 'expiry' | 'manual';
  newEpoch: number;
  wrappedKeys: VfsWrappedKeyPayload[];
}

/**
 * Response from a successful rekey operation.
 */
export interface VfsRekeyResponse {
  itemId: string;
  newEpoch: number;
  wrapsApplied: number;
}
