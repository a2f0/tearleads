/**
 * Shared types and utilities
 */

export * from './crypto/asymmetric.js';
// Crypto utilities
export * from './crypto/web-crypto.js';

// Note: Redis client is exported separately via '@rapid/shared/redis'
// to avoid bundling Node.js-only code into browser bundles

// License types
export interface LicenseInfo {
  name: string;
  version: string;
  license: string;
  repository?: string;
}

// Chat validation helpers
export * from './chat.js';

// OpenRouter model options
export * from './openrouter.js';

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

export interface AdminUser {
  id: string;
  email: string;
  emailConfirmed: boolean;
  admin: boolean;
  organizationIds: string[];
  createdAt: string | null;
  lastActiveAt: string | null;
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

// Utilities
export function formatDate(date: Date): string {
  return date.toISOString();
}

// Type Guards

/**
 * Type guard to check if a value is a non-null object (record).
 */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/**
 * Assertion function to narrow Uint8Array<ArrayBufferLike> to Uint8Array<ArrayBuffer>.
 *
 * With @tsconfig/strictest, Uint8Array is typed as Uint8Array<ArrayBufferLike>
 * where ArrayBufferLike = ArrayBuffer | SharedArrayBuffer. Web Crypto API and
 * Blob constructor expect plain ArrayBuffer, not ArrayBufferLike.
 *
 * In practice, Uint8Arrays always use plain ArrayBuffer - SharedArrayBuffer
 * requires explicit opt-in and specific headers. This assertion narrows the type
 * by checking for SharedArrayBuffer rather than ArrayBuffer (since instanceof
 * ArrayBuffer can fail across realms in test environments).
 */
export function assertPlainArrayBuffer(
  arr: Uint8Array<ArrayBufferLike>
): asserts arr is Uint8Array<ArrayBuffer> {
  if (
    typeof SharedArrayBuffer !== 'undefined' &&
    arr.buffer instanceof SharedArrayBuffer
  ) {
    throw new Error(
      'Unexpected SharedArrayBuffer backing Uint8Array. This should never occur in normal operation.'
    );
  }
}

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
