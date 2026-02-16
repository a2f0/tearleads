/**
 * Shared Admin types
 */

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

export interface AdminScopeOrganization {
  id: string;
  name: string;
}

export interface AdminAccessContextResponse {
  isRootAdmin: boolean;
  organizations: AdminScopeOrganization[];
  defaultOrganizationId: string | null;
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

export type OrganizationBillingEntitlementStatus =
  | 'inactive'
  | 'trialing'
  | 'active'
  | 'grace_period'
  | 'expired';

export interface OrganizationBillingAccount {
  organizationId: string;
  revenueCatAppUserId: string;
  entitlementStatus: OrganizationBillingEntitlementStatus;
  activeProductId: string | null;
  periodEndsAt: string | null;
  willRenew: boolean | null;
  lastWebhookEventId: string | null;
  lastWebhookAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface OrganizationBillingAccountResponse {
  billingAccount: OrganizationBillingAccount;
}
