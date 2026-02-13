/**
 * Shared types and utilities
 */

import { assertPlainArrayBuffer, isRecord } from './type-guards.js';

export * from './crypto/asymmetric.js';
// Crypto utilities
export * from './crypto/web-crypto.js';

// Note: Redis client is exported separately via '@tearleads/shared/redis'
// to avoid bundling Node.js-only code into browser bundles

// License types
export interface LicenseInfo {
  name: string;
  version: string;
  license: string;
  repository?: string;
}

// AI conversations
export * from './ai-conversations.js';
// Chat validation helpers
export * from './chat.js';
// Media drag-and-drop helpers
export * from './media-drag-data.js';
// OpenRouter model options
export * from './openrouter.js';
// Tree utilities
export * from './tree/index.js';

// Types
export interface PingData {
  version: string;
  dbVersion: string;
  emailDomain?: string;
}

// Admin types
export interface RedisKeyInfo {
  key: string;
  type: string;
  ttl: number;
}

export interface RedisKeysResponse {
  keys: RedisKeyInfo[];
  cursor: string;
  hasMore: boolean;
}

export interface RedisKeyValueResponse {
  key: string;
  type: string;
  ttl: number;
  value: string | string[] | Record<string, string> | null;
}

export interface PostgresConnectionInfo {
  host: string | null;
  port: number | null;
  database: string | null;
  user: string | null;
}

export interface PostgresAdminInfoResponse {
  status: 'ok';
  info: PostgresConnectionInfo;
  serverVersion: string | null;
}

export interface PostgresTableInfo {
  schema: string;
  name: string;
  rowCount: number;
  totalBytes: number;
  tableBytes: number;
  indexBytes: number;
}

export interface PostgresTablesResponse {
  tables: PostgresTableInfo[];
}

export interface PostgresColumnInfo {
  name: string;
  type: string;
  nullable: boolean;
  defaultValue: string | null;
  ordinalPosition: number;
}

export interface PostgresColumnsResponse {
  columns: PostgresColumnInfo[];
}

export interface PostgresRowsResponse {
  rows: Record<string, unknown>[];
  totalCount: number;
  limit: number;
  offset: number;
}

export interface AdminUserAccounting {
  totalPromptTokens: number;
  totalCompletionTokens: number;
  totalTokens: number;
  requestCount: number;
  lastUsedAt: string | null;
}

export interface AdminUser {
  id: string;
  email: string;
  emailConfirmed: boolean;
  admin: boolean;
  organizationIds: string[];
  createdAt: string | null;
  lastActiveAt: string | null;
  accounting: AdminUserAccounting;
  disabled: boolean;
  disabledAt: string | null;
  disabledBy: string | null;
  markedForDeletionAt: string | null;
  markedForDeletionBy: string | null;
}

export interface AdminUsersResponse {
  users: AdminUser[];
}

export interface AdminUserResponse {
  user: AdminUser;
}

export interface AdminUserUpdatePayload {
  email?: string;
  emailConfirmed?: boolean;
  admin?: boolean;
  organizationIds?: string[];
  disabled?: boolean;
  markedForDeletion?: boolean;
}

export interface AdminUserUpdateResponse {
  user: AdminUser;
}

// Groups Admin types
export interface Group {
  id: string;
  organizationId: string;
  name: string;
  description: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface GroupWithMemberCount extends Group {
  memberCount: number;
}

export interface GroupMember {
  userId: string;
  email: string;
  joinedAt: string;
}

export interface GroupsListResponse {
  groups: GroupWithMemberCount[];
}

export interface GroupDetailResponse {
  group: Group;
  members: GroupMember[];
}

export interface CreateGroupRequest {
  name: string;
  description?: string;
  organizationId: string;
}

export interface UpdateGroupRequest {
  name?: string;
  description?: string;
  organizationId?: string;
}

export interface AddMemberRequest {
  userId: string;
}

export interface GroupMembersResponse {
  members: GroupMember[];
}

// Organizations Admin types
export interface Organization {
  id: string;
  name: string;
  description: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface OrganizationsListResponse {
  organizations: Organization[];
}

export interface OrganizationResponse {
  organization: Organization;
}

export interface CreateOrganizationRequest {
  name: string;
  description?: string;
}

export interface UpdateOrganizationRequest {
  name?: string;
  description?: string;
}

export interface OrganizationUser {
  id: string;
  email: string;
  joinedAt: string;
}

export interface OrganizationGroup {
  id: string;
  name: string;
  description: string | null;
  memberCount: number;
}

export interface OrganizationUsersResponse {
  users: OrganizationUser[];
}

export interface OrganizationGroupsResponse {
  groups: OrganizationGroup[];
}

// Auth types
export interface AuthUser {
  id: string;
  email: string;
}

export interface RegisterRequest {
  email: string;
  password: string;
}

export interface AuthResponse {
  accessToken: string;
  refreshToken: string;
  tokenType: string;
  expiresIn: number;
  refreshExpiresIn: number;
  user: AuthUser;
}

export interface Session {
  id: string;
  createdAt: string;
  lastActiveAt: string;
  ipAddress: string;
  isCurrent: boolean;
  isAdmin: boolean;
}

export interface SessionsResponse {
  sessions: Session[];
}

// SSE types
export type SSEConnectionState = 'connected' | 'connecting' | 'disconnected';

export interface BroadcastMessage {
  type: string;
  payload: unknown;
  timestamp: string;
}

export interface SSEMessage {
  channel: string;
  message: BroadcastMessage;
}

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

// =============================================================================
// MLS (RFC 9420) Encrypted Chat Types
// =============================================================================

/** MLS ciphersuites - X-Wing hybrid (ML-KEM + X25519) for post-quantum security */
export const MLS_CIPHERSUITES = {
  /** MLS_128_DHKEMX25519_AES128GCM_SHA256_Ed25519 */
  X25519_AES128GCM: 1,
  /** MLS_128_DHKEMX25519_CHACHA20POLY1305_SHA256_Ed25519 */
  X25519_CHACHA20_SHA256_ED25519: 3,
  /** X-Wing hybrid: ML-KEM-768 + X25519 for post-quantum security */
  XWING_HYBRID: 65535
} as const;

export type MlsCipherSuite =
  (typeof MLS_CIPHERSUITES)[keyof typeof MLS_CIPHERSUITES];

/** MLS key package stored on server */
export interface MlsKeyPackage {
  id: string;
  userId: string;
  keyPackageData: string; // base64
  keyPackageRef: string; // base64 hash
  cipherSuite: MlsCipherSuite;
  createdAt: string;
  consumed: boolean;
}

/** MLS group metadata */
export interface MlsGroup {
  id: string;
  groupIdMls: string; // base64 MLS group ID
  name: string;
  description: string | null;
  creatorUserId: string;
  currentEpoch: number;
  cipherSuite: MlsCipherSuite;
  createdAt: string;
  updatedAt: string;
  lastMessageAt?: string;
  memberCount?: number;
  role?: MlsGroupRole;
}

export type MlsGroupRole = 'admin' | 'member';

/** MLS group member info */
export interface MlsGroupMember {
  userId: string;
  email: string;
  leafIndex: number | null;
  role: MlsGroupRole;
  joinedAt: string;
  joinedAtEpoch: number;
}

export type MlsMessageType = 'application' | 'commit' | 'proposal';

/** MLS encrypted message (server only stores ciphertext) */
export interface MlsMessage {
  id: string;
  groupId: string;
  senderUserId: string | null; // null if sender was deleted
  senderEmail?: string;
  epoch: number;
  ciphertext: string; // base64
  messageType: MlsMessageType;
  contentType: string;
  sequenceNumber: number;
  sentAt: string;
  createdAt: string;
}

/** MLS welcome message for joining a group */
export interface MlsWelcomeMessage {
  id: string;
  groupId: string;
  groupName: string;
  welcome: string; // base64 welcome data
  keyPackageRef: string; // reference to the key package used
  epoch: number;
  createdAt: string;
}

/** MLS group state snapshot for multi-device sync */
export interface MlsGroupState {
  id: string;
  groupId: string;
  epoch: number;
  encryptedState: string; // base64, encrypted client-side
  stateHash: string;
  createdAt: string;
}

// MLS API Request/Response types

export interface UploadMlsKeyPackagesRequest {
  keyPackages: Array<{
    keyPackageData: string;
    keyPackageRef: string;
    cipherSuite: MlsCipherSuite;
  }>;
}

export interface UploadMlsKeyPackagesResponse {
  keyPackages: MlsKeyPackage[];
}

export interface MlsKeyPackagesResponse {
  keyPackages: MlsKeyPackage[];
}

export interface CreateMlsGroupRequest {
  name: string;
  description?: string;
  groupIdMls: string;
  cipherSuite: MlsCipherSuite;
}

export interface CreateMlsGroupResponse {
  group: MlsGroup;
}

export interface MlsGroupsResponse {
  groups: MlsGroup[];
}

export interface MlsGroupResponse {
  group: MlsGroup;
  members: MlsGroupMember[];
}

export interface UpdateMlsGroupRequest {
  name?: string;
  description?: string;
}

export interface AddMlsMemberRequest {
  userId: string;
  commit: string; // base64 MLS commit
  welcome: string; // base64 MLS welcome
  keyPackageRef: string;
  newEpoch: number;
}

export interface AddMlsMemberResponse {
  member: MlsGroupMember;
}

export interface RemoveMlsMemberRequest {
  commit: string; // base64 MLS commit
  newEpoch: number;
}

export interface MlsGroupMembersResponse {
  members: MlsGroupMember[];
}

export interface SendMlsMessageRequest {
  ciphertext: string; // base64
  epoch: number;
  messageType: MlsMessageType;
  contentType?: string;
}

export interface SendMlsMessageResponse {
  message: MlsMessage;
}

export interface MlsMessagesResponse {
  messages: MlsMessage[];
  hasMore: boolean;
  cursor?: string;
}

export interface MlsWelcomeMessagesResponse {
  welcomes: MlsWelcomeMessage[];
}

export interface AckMlsWelcomeRequest {
  groupId: string;
}

export interface UploadMlsStateRequest {
  epoch: number;
  encryptedState: string;
  stateHash: string;
}

export interface UploadMlsStateResponse {
  state: MlsGroupState;
}

export interface MlsGroupStateResponse {
  state: MlsGroupState | null;
}

/** SSE message types for MLS real-time */
export type MlsSseMessageType =
  | 'mls:message'
  | 'mls:commit'
  | 'mls:welcome'
  | 'mls:member_added'
  | 'mls:member_removed';

export interface MlsSsePayload {
  type: MlsSseMessageType;
  groupId: string;
  data: MlsMessage | MlsWelcomeMessage | MlsGroupMember;
}

// Utilities
export function formatDate(date: Date): string {
  return date.toISOString();
}

export { assertPlainArrayBuffer, isRecord };

/**
 * Safely extract an error code from an unknown error value.
 * Returns undefined if the error doesn't have a string code property.
 */
export function getErrorCode(error: unknown): string | undefined {
  if (!isRecord(error)) {
    return undefined;
  }
  const code = error['code'];
  return typeof code === 'string' ? code : undefined;
}

/**
 * Safely convert a value to a finite number, returning null if not possible.
 * Handles both numbers and numeric strings (useful for SQLite query results).
 */
export function toFiniteNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return null;
}
