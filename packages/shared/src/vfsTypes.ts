export type VfsAclPrincipalType = 'user' | 'group' | 'organization';
export type VfsAclAccessLevel = 'read' | 'write' | 'admin';

export type VfsObjectType =
  | 'file'
  | 'folder'
  | 'organization'
  | 'user'
  | 'group'
  | 'email'
  | 'device'
  | 'photo'
  | 'audio'
  | 'video'
  | 'contact'
  | 'note'
  | 'mlsMessage'
  | 'conversation'
  | 'emailFolder'
  | 'playlist'
  | 'album'
  | 'contactGroup'
  | 'tag'
  | 'healthReading'
  | 'blob';

export const VFS_OBJECT_TYPES: VfsObjectType[] = [
  'file',
  'folder',
  'organization',
  'user',
  'group',
  'email',
  'device',
  'photo',
  'audio',
  'video',
  'contact',
  'note',
  'mlsMessage',
  'conversation',
  'emailFolder',
  'playlist',
  'album',
  'contactGroup',
  'tag',
  'healthReading',
  'blob'
];

export const VFS_CONTAINER_OBJECT_TYPES: VfsObjectType[] = [
  'folder',
  'organization',
  'user',
  'group',
  'emailFolder',
  'album',
  'contactGroup'
];

export type VfsSyncChangeType =
  | 'upsert'
  | 'delete'
  | 'acl'
  | 'acl_add'
  | 'acl_remove'
  | 'link_add'
  | 'link_remove'
  | 'item_upsert'
  | 'item_delete'
  | 'link_reassign';

export type VfsCrdtOpType =
  | 'acl_add'
  | 'acl_remove'
  | 'link_add'
  | 'link_remove'
  | 'link_reassign'
  | 'item_upsert'
  | 'item_delete';

export interface VfsSyncCursor {
  changedAt: string;
  changeId: string;
}

export interface VfsSyncBloomFilter {
  data: string;
  capacity: number;
  errorRate: number;
}

export interface VfsSyncItem {
  changeId: string;
  itemId: string;
  changeType: string;
  changedAt: string;
  objectType: string | null;
  encryptedName: string | null;
  ownerId: string | null;
  createdAt: string | null;
  accessLevel: VfsAclAccessLevel;
}

export interface VfsSyncResponse {
  items: VfsSyncItem[];
  nextCursor: string | null;
  hasMore: boolean;
}

export interface VfsSyncReconcileResponse {
  clientId: string;
  cursor: string;
}

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
  encryptedPayload?: string | null;
  /** Key epoch used for encryption */
  keyEpoch?: number | null;
  /** Encryption nonce (base64-encoded) */
  encryptionNonce?: string | null;
  /** Additional authenticated data hash (base64-encoded) */
  encryptionAad?: string | null;
  /** Operation signature for integrity verification (base64-encoded) */
  encryptionSignature?: string | null;
  /** Blob ID attached to this item, if any */
  blobId?: string | null;
  /** Blob size in bytes */
  blobSizeBytes?: number | null;
  /** Blob relation kind (file, emailAttachment, photo, other) */
  blobRelationKind?: string | null;
}

export interface VfsCrdtSyncResponse {
  items: VfsCrdtSyncItem[];
  nextCursor: string | null;
  hasMore: boolean;
  lastReconciledWriteIds: Record<string, number>;
  bloomFilter?: VfsSyncBloomFilter | null;
}

export interface VfsCrdtReconcileRequest {
  organizationId?: string | null;
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
  /** Ed25519 signature over canonical ACL operation fields (base64-encoded) */
  operationSignature?: string;
}

export interface VfsCrdtPushRequest {
  organizationId?: string | null;
  clientId: string;
  operations: VfsCrdtPushOperation[];
}

export type VfsCrdtPushStatus =
  | 'applied'
  | 'alreadyApplied'
  | 'staleWriteId'
  | 'outdatedOp'
  | 'invalidOp'
  | 'aclDenied'
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
  organizationId?: string | null;
  clientId: string;
  cursor: string;
  limit: number;
  operations: VfsCrdtPushOperation[];
  lastReconciledWriteIds: Record<string, number>;
  rootId?: string | null;
  bloomFilter?: VfsSyncBloomFilter | null;
}

export interface VfsCrdtSyncSessionResponse {
  push: VfsCrdtPushResponse;
  pull: VfsCrdtSyncResponse;
  reconcile: VfsCrdtReconcileResponse;
}

// VFS Sharing types
export type VfsShareType = 'user' | 'group' | 'organization';
export type VfsPermissionLevel = 'view' | 'edit' | 'download';

export interface VfsWrappedKeyPayload {
  recipientUserId: string;
  recipientPublicKeyId: string;
  keyEpoch: number;
  encryptedKey: string;
  senderSignature: string;
}

export interface VfsOrgWrappedKeyPayload {
  recipientOrgId: string;
  recipientPublicKeyId: string;
  keyEpoch: number;
  encryptedKey: string;
  senderSignature: string;
}

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
  wrappedKey?: VfsOrgWrappedKeyPayload;
}

export interface VfsKeySetupRequest {
  publicEncryptionKey: string;
  publicSigningKey: string;
  encryptedPrivateKeys: string;
  argon2Salt: string;
}

export interface VfsUserKeysResponse {
  publicEncryptionKey: string;
  publicSigningKey: string;
  publicKeyIds?: string[];
  encryptedPrivateKeys?: string;
  argon2Salt?: string;
}

export interface VfsRekeyRequest {
  reason: 'manual' | 'unshare' | 'expiry';
  newEpoch: number;
  wrappedKeys: VfsWrappedKeyPayload[];
  itemId?: string;
  encryptedSessionKey?: string;
  keyEpoch?: number;
}

export interface VfsRekeyResponse {
  success: boolean;
  itemId: string;
  newEpoch: number;
  wrapsApplied: number;
}

export interface VfsSharesResponse {
  shares: VfsShare[];
  orgShares: VfsOrgShare[];
}

export interface ShareTargetSearchResult {
  id: string;
  type: VfsShareType;
  name: string;
  description: string | null;
}

export interface ShareTargetSearchResponse {
  results: ShareTargetSearchResult[];
}

export interface CreateVfsShareRequest {
  itemId: string;
  shareType: VfsShareType;
  targetId: string;
  permissionLevel: VfsPermissionLevel;
  expiresAt?: string | null;
  wrappedKey?: VfsWrappedKeyPayload | null;
}

export interface CreateOrgShareRequest {
  itemId: string;
  sourceOrgId: string;
  targetOrgId: string;
  permissionLevel: VfsPermissionLevel;
  expiresAt?: string | null;
  wrappedKey?: VfsOrgWrappedKeyPayload | null;
}

export interface UpdateVfsShareRequest {
  shareId: string;
  permissionLevel?: VfsPermissionLevel | null;
  expiresAt?: string | null;
  clearExpiresAt?: boolean;
}

export interface VfsSharePolicyPreviewRequest {
  rootItemId: string;
  principalType: VfsAclPrincipalType;
  principalId: string;
  limit: number;
  cursor?: string | null;
  maxDepth?: number | null;
  q?: string | null;
  objectType?: VfsObjectType[] | null;
}

export interface VfsSharePolicyPreviewNode {
  itemId: string;
  objectType: VfsObjectType;
  depth: number;
  path: string;
  state: string;
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

export interface VfsSharePolicyPreviewResponse {
  nodes: VfsSharePolicyPreviewNode[];
  summary: VfsSharePolicyPreviewSummary;
  nextCursor: string | null;
}

export interface VfsRegisterRequest {
  id: string;
  objectType: string;
  encryptedSessionKey: string;
  encryptedName?: string;
}

export interface VfsRegisterResponse {
  id: string;
  createdAt: string;
}

export interface CommitBlobRequest {
  stagingId: string;
  uploadId: string;
  keyEpoch: number;
  manifestHash: string;
  manifestSignature: string;
  chunkCount: number;
  totalPlaintextBytes: number;
  totalCiphertextBytes: number;
}
