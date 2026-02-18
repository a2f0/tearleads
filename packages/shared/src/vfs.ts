/**
 * Shared VFS types
 */

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
