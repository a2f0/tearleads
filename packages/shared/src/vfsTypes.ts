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
  | 'photo'
  | 'audio'
  | 'video'
  | 'contact'
  | 'note'
  | 'email'
  | 'conversation'
  // Collections
  | 'folder'
  | 'emailFolder'
  | 'playlist'
  | 'album'
  | 'contactGroup'
  | 'tag';

export const VFS_CONTAINER_OBJECT_TYPES = [
  'folder',
  'emailFolder',
  'playlist',
  'contact'
] as const;

export type VfsContainerObjectType =
  (typeof VFS_CONTAINER_OBJECT_TYPES)[number];

export interface VfsRegisterRequest {
  id: string;
  objectType: VfsObjectType;
  encryptedSessionKey: string;
  encryptedName?: string;
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
  encryptedName?: string | null;
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
  | 'link_remove'
  | 'item_upsert'
  | 'item_delete';

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
  /** Encrypted operation payload (base64-encoded ciphertext) */
  encryptedPayload?: string;
  /** Key epoch used for encryption */
  keyEpoch?: number;
  /** Encryption nonce (base64-encoded) */
  encryptionNonce?: string;
  /** Additional authenticated data hash (base64-encoded) */
  encryptionAad?: string;
  /** Operation signature for integrity verification (base64-encoded) */
  encryptionSignature?: string;
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
  /** Encrypted operation payload (base64-encoded ciphertext) */
  encryptedPayload?: string;
  /** Key epoch used for encryption */
  keyEpoch?: number;
  /** Encryption nonce (base64-encoded) */
  encryptionNonce?: string;
  /** Additional authenticated data hash (base64-encoded) */
  encryptionAad?: string;
  /** Operation signature for integrity verification (base64-encoded) */
  encryptionSignature?: string;
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
  | 'invalidOp'
  | 'encryptedEnvelopeUnsupported';

export interface VfsCrdtPushResult {
  opId: string;
  status: VfsCrdtPushStatus;
}

export interface VfsCrdtPushResponse {
  clientId: string;
  results: VfsCrdtPushResult[];
}

export interface VfsCrdtSyncSessionRequest {
  clientId: string;
  cursor: string;
  limit: number;
  operations: VfsCrdtPushOperation[];
  lastReconciledWriteIds?: Record<string, number>;
  rootId?: string | null;
}

export interface VfsCrdtSyncSessionResponse {
  push: VfsCrdtPushResponse;
  pull: VfsCrdtSyncResponse;
  reconcile: VfsCrdtReconcileResponse;
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
  /**
   * Wrapped key metadata for encrypted user shares.
   * Present when server has persisted share-key material for this share.
   */
  wrappedKey?: VfsWrappedKeyPayload;
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
  /**
   * Wrapped key metadata for encrypted org shares.
   * Present when server has persisted share-key material for this share.
   */
  wrappedKey?: VfsOrgWrappedKeyPayload;
}

export interface CreateVfsShareRequest {
  itemId: string;
  shareType: VfsShareType;
  targetId: string;
  permissionLevel: VfsPermissionLevel;
  expiresAt?: string | null;
  /**
   * Wrapped key payload for encrypted user shares.
   * Must target the same user as `targetId` when provided.
   */
  wrappedKey?: VfsWrappedKeyPayload | null;
}

export interface CreateOrgShareRequest {
  itemId: string;
  sourceOrgId: string;
  targetOrgId: string;
  permissionLevel: VfsPermissionLevel;
  expiresAt?: string | null;
  /**
   * Wrapped key payload for encrypted org shares.
   * Must target the same org as `targetOrgId` when provided.
   */
  wrappedKey?: VfsOrgWrappedKeyPayload | null;
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

export type VfsSharePolicyPreviewState =
  | 'included'
  | 'excluded'
  | 'denied'
  | 'direct'
  | 'derived';

export interface VfsSharePolicyPreviewNode {
  itemId: string;
  objectType: VfsObjectType;
  depth: number;
  path: string;
  state: VfsSharePolicyPreviewState;
  effectiveAccessLevel: VfsAclAccessLevel | null;
  sourcePolicyIds: string[];
}

export interface VfsSharePolicyPreviewSummary {
  totalMatchingNodes: number;
  returnedNodes: number;
  directCount: number;
  derivedCount: number;
  deniedCount: number;
  includedCount: number;
  excludedCount: number;
}

export interface VfsSharePolicyPreviewRequest {
  rootItemId: string;
  principalType: VfsShareType;
  principalId: string;
  limit?: number;
  cursor?: string | null;
  maxDepth?: number | null;
  q?: string | null;
  objectType?: string[] | null;
}

export interface VfsSharePolicyPreviewResponse {
  nodes: VfsSharePolicyPreviewNode[];
  summary: VfsSharePolicyPreviewSummary;
  nextCursor: string | null;
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
 * Wrapped key payload for a target organization.
 * Mirrors user wrapped-key metadata with org recipient identity.
 */
export interface VfsOrgWrappedKeyPayload {
  recipientOrgId: string;
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
