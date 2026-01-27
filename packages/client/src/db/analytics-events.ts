/**
 * Strongly typed analytics event definitions.
 *
 * This file defines all known analytics event slugs, their display names,
 * and typed detail payloads for each event type.
 */

// All known event slugs (snake_case, stored in DB)
export type AnalyticsEventSlug =
  // Database operations
  | 'db_setup'
  | 'db_unlock'
  | 'db_session_restore'
  | 'db_password_change'
  // File operations
  | 'file_encrypt'
  | 'file_decrypt'
  | 'thumbnail_generation'
  // API operations
  | 'api_get_ping'
  | 'api_get_admin_redis_keys'
  | 'api_get_admin_redis_key'
  | 'api_delete_admin_redis_key'
  | 'api_get_admin_redis_dbsize'
  | 'api_get_admin_postgres_info'
  | 'api_get_admin_postgres_tables'
  | 'api_get_admin_postgres_columns'
  | 'api_get_admin_postgres_rows'
  | 'api_get_admin_users'
  | 'api_get_admin_user'
  | 'api_patch_admin_user'
  | 'api_get_admin_groups'
  | 'api_get_admin_group'
  | 'api_post_admin_group'
  | 'api_put_admin_group'
  | 'api_delete_admin_group'
  | 'api_get_admin_group_members'
  | 'api_post_admin_group_member'
  | 'api_delete_admin_group_member'
  | 'api_get_admin_organizations'
  | 'api_get_admin_organization'
  | 'api_get_admin_organization_users'
  | 'api_get_admin_organization_groups'
  | 'api_post_admin_organization'
  | 'api_put_admin_organization'
  | 'api_delete_admin_organization'
  | 'api_post_auth_login'
  | 'api_post_auth_logout'
  | 'api_post_auth_refresh'
  | 'api_get_auth_sessions'
  | 'api_delete_auth_session'
  // VFS operations
  | 'api_get_vfs_keys'
  | 'api_post_vfs_keys'
  | 'api_post_vfs_register'
  // LLM operations
  | 'llm_model_load'
  | 'llm_prompt_text'
  | 'llm_prompt_multimodal'
  | 'llm_classify_image';

// Hand-curated display names
export const EVENT_DISPLAY_NAMES: Record<AnalyticsEventSlug, string> = {
  // Database
  db_setup: 'Database Setup',
  db_unlock: 'Database Unlock',
  db_session_restore: 'Session Restore',
  db_password_change: 'Password Change',
  // Files
  file_encrypt: 'File Encrypt',
  file_decrypt: 'File Decrypt',
  thumbnail_generation: 'Thumbnail Generation',
  // API
  api_get_ping: 'API Ping',
  api_get_admin_redis_keys: 'API List Redis Keys',
  api_get_admin_redis_key: 'API Get Redis Key',
  api_delete_admin_redis_key: 'API Delete Redis Key',
  api_get_admin_redis_dbsize: 'API Redis DB Size',
  api_get_admin_postgres_info: 'API Postgres Info',
  api_get_admin_postgres_tables: 'API Postgres Tables',
  api_get_admin_postgres_columns: 'API Postgres Columns',
  api_get_admin_postgres_rows: 'API Postgres Rows',
  api_get_admin_users: 'API List Users',
  api_get_admin_user: 'API Get User',
  api_patch_admin_user: 'API Update User',
  api_get_admin_groups: 'API List Groups',
  api_get_admin_group: 'API Get Group',
  api_post_admin_group: 'API Create Group',
  api_put_admin_group: 'API Update Group',
  api_delete_admin_group: 'API Delete Group',
  api_get_admin_group_members: 'API Get Group Members',
  api_post_admin_group_member: 'API Add Group Member',
  api_delete_admin_group_member: 'API Remove Group Member',
  api_get_admin_organizations: 'API List Organizations',
  api_get_admin_organization: 'API Get Organization',
  api_get_admin_organization_users: 'API Get Organization Users',
  api_get_admin_organization_groups: 'API Get Organization Groups',
  api_post_admin_organization: 'API Create Organization',
  api_put_admin_organization: 'API Update Organization',
  api_delete_admin_organization: 'API Delete Organization',
  api_post_auth_login: 'API Auth Login',
  api_post_auth_logout: 'API Auth Logout',
  api_post_auth_refresh: 'API Auth Refresh',
  api_get_auth_sessions: 'API Get Sessions',
  api_delete_auth_session: 'API Delete Session',
  // VFS
  api_get_vfs_keys: 'API Get VFS Keys',
  api_post_vfs_keys: 'API Setup VFS Keys',
  api_post_vfs_register: 'API Register VFS Item',
  // LLM
  llm_model_load: 'LLM Model Load',
  llm_prompt_text: 'LLM Text Prompt',
  llm_prompt_multimodal: 'LLM Multimodal Prompt',
  llm_classify_image: 'LLM Image Classification'
};

/**
 * Get the display name for an event slug.
 * Falls back to the raw slug if not found in the mapping.
 */
export function getEventDisplayName(slug: string): string {
  if (Object.hasOwn(EVENT_DISPLAY_NAMES, slug)) {
    return EVENT_DISPLAY_NAMES[slug as AnalyticsEventSlug];
  }
  return slug;
}

// -----------------------------------------------------------------------------
// Per-event detail types
// -----------------------------------------------------------------------------

// Database events - no detail needed for now
export type DbSetupDetail = Record<string, never>;
export type DbUnlockDetail = Record<string, never>;
export type DbSessionRestoreDetail = Record<string, never>;
export type DbPasswordChangeDetail = Record<string, never>;

// File events
export interface FileEncryptDetail {
  fileSize?: number;
  mimeType?: string;
}
export interface FileDecryptDetail {
  fileSize?: number;
  mimeType?: string;
}
export interface ThumbnailGenerationDetail {
  fileSize?: number;
  mimeType?: string;
}

// API events
export interface ApiGetPingDetail {
  apiVersion?: string;
}
export interface ApiGetAdminRedisKeysDetail {
  cursor?: string;
  count?: number;
}
export interface ApiGetAdminRedisKeyDetail {
  keyType?: string;
}
export interface ApiDeleteAdminRedisKeyDetail {
  deleted?: boolean;
}
export interface ApiGetAdminRedisDbsizeDetail {
  dbSize?: number;
}
export interface ApiGetAdminPostgresInfoDetail {
  status?: string;
}
export interface ApiGetAdminPostgresTablesDetail {
  tableCount?: number;
}
export interface ApiGetAdminPostgresColumnsDetail {
  columnCount?: number;
}
export interface ApiGetAdminPostgresRowsDetail {
  rowCount?: number;
}
export interface ApiGetAdminUsersDetail {
  userCount?: number;
}
export interface ApiGetAdminUserDetail {
  userId?: string;
}
export interface ApiPatchAdminUserDetail {
  userId?: string;
}
export interface ApiGetAdminGroupsDetail {
  groupCount?: number;
}
export interface ApiGetAdminGroupDetail {
  memberCount?: number;
}
export interface ApiPostAdminGroupDetail {
  groupName?: string;
}
export interface ApiPutAdminGroupDetail {
  groupId?: string;
}
export interface ApiDeleteAdminGroupDetail {
  deleted?: boolean;
}
export interface ApiGetAdminGroupMembersDetail {
  memberCount?: number;
}
export interface ApiPostAdminGroupMemberDetail {
  userId?: string;
}
export interface ApiDeleteAdminGroupMemberDetail {
  removed?: boolean;
}
export interface ApiGetAdminOrganizationsDetail {
  organizationCount?: number;
}
export interface ApiGetAdminOrganizationDetail {
  organizationId?: string;
}
export interface ApiGetAdminOrganizationUsersDetail {
  userCount?: number;
}
export interface ApiGetAdminOrganizationGroupsDetail {
  groupCount?: number;
}
export interface ApiPostAdminOrganizationDetail {
  organizationName?: string;
}
export interface ApiPutAdminOrganizationDetail {
  organizationId?: string;
}
export interface ApiDeleteAdminOrganizationDetail {
  deleted?: boolean;
}
export interface ApiPostAuthLoginDetail {
  email?: string;
}
export interface ApiPostAuthLogoutDetail {
  loggedOut?: boolean;
}
export interface ApiPostAuthRefreshDetail {
  refreshed?: boolean;
}
export interface ApiGetAuthSessionsDetail {
  sessionCount?: number;
}
export interface ApiDeleteAuthSessionDetail {
  deleted?: boolean;
}

// VFS events
export interface ApiGetVfsKeysDetail {
  hasKeys?: boolean;
}
export interface ApiPostVfsKeysDetail {
  created?: boolean;
}
export interface ApiPostVfsRegisterDetail {
  objectType?: string;
}

// LLM events
export interface LlmModelLoadDetail {
  modelName?: string;
}
export interface LlmPromptTextDetail {
  modelName?: string;
  promptLength?: number;
}
export interface LlmPromptMultimodalDetail {
  modelName?: string;
  hasImage?: boolean;
}
export interface LlmClassifyImageDetail {
  modelName?: string;
  classification?: string;
}

// Map event slugs to their detail types
export interface EventDetailMap {
  db_setup: DbSetupDetail;
  db_unlock: DbUnlockDetail;
  db_session_restore: DbSessionRestoreDetail;
  db_password_change: DbPasswordChangeDetail;
  file_encrypt: FileEncryptDetail;
  file_decrypt: FileDecryptDetail;
  thumbnail_generation: ThumbnailGenerationDetail;
  api_get_ping: ApiGetPingDetail;
  api_get_admin_redis_keys: ApiGetAdminRedisKeysDetail;
  api_get_admin_redis_key: ApiGetAdminRedisKeyDetail;
  api_delete_admin_redis_key: ApiDeleteAdminRedisKeyDetail;
  api_get_admin_redis_dbsize: ApiGetAdminRedisDbsizeDetail;
  api_get_admin_postgres_info: ApiGetAdminPostgresInfoDetail;
  api_get_admin_postgres_tables: ApiGetAdminPostgresTablesDetail;
  api_get_admin_postgres_columns: ApiGetAdminPostgresColumnsDetail;
  api_get_admin_postgres_rows: ApiGetAdminPostgresRowsDetail;
  api_get_admin_users: ApiGetAdminUsersDetail;
  api_get_admin_user: ApiGetAdminUserDetail;
  api_patch_admin_user: ApiPatchAdminUserDetail;
  api_get_admin_groups: ApiGetAdminGroupsDetail;
  api_get_admin_group: ApiGetAdminGroupDetail;
  api_post_admin_group: ApiPostAdminGroupDetail;
  api_put_admin_group: ApiPutAdminGroupDetail;
  api_delete_admin_group: ApiDeleteAdminGroupDetail;
  api_get_admin_group_members: ApiGetAdminGroupMembersDetail;
  api_post_admin_group_member: ApiPostAdminGroupMemberDetail;
  api_delete_admin_group_member: ApiDeleteAdminGroupMemberDetail;
  api_get_admin_organizations: ApiGetAdminOrganizationsDetail;
  api_get_admin_organization: ApiGetAdminOrganizationDetail;
  api_get_admin_organization_users: ApiGetAdminOrganizationUsersDetail;
  api_get_admin_organization_groups: ApiGetAdminOrganizationGroupsDetail;
  api_post_admin_organization: ApiPostAdminOrganizationDetail;
  api_put_admin_organization: ApiPutAdminOrganizationDetail;
  api_delete_admin_organization: ApiDeleteAdminOrganizationDetail;
  api_post_auth_login: ApiPostAuthLoginDetail;
  api_post_auth_logout: ApiPostAuthLogoutDetail;
  api_post_auth_refresh: ApiPostAuthRefreshDetail;
  api_get_auth_sessions: ApiGetAuthSessionsDetail;
  api_delete_auth_session: ApiDeleteAuthSessionDetail;
  api_get_vfs_keys: ApiGetVfsKeysDetail;
  api_post_vfs_keys: ApiPostVfsKeysDetail;
  api_post_vfs_register: ApiPostVfsRegisterDetail;
  llm_model_load: LlmModelLoadDetail;
  llm_prompt_text: LlmPromptTextDetail;
  llm_prompt_multimodal: LlmPromptMultimodalDetail;
  llm_classify_image: LlmClassifyImageDetail;
}

// Union of all detail types
export type AnalyticsEventDetail = EventDetailMap[AnalyticsEventSlug];
