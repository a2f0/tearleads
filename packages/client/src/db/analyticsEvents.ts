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
  | 'vfs_secure_upload'
  | 'vfs_blob_flush_operation'
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
  | 'api_post_auth_register'
  | 'api_post_auth_logout'
  | 'api_post_auth_refresh'
  | 'api_get_auth_sessions'
  | 'api_get_auth_organizations'
  | 'api_delete_auth_session'
  // VFS operations
  | 'api_get_vfs_keys'
  | 'api_get_vfs_sync'
  | 'api_get_vfs_crdt_sync'
  | 'api_post_vfs_keys'
  | 'api_post_vfs_register'
  | 'api_get_vfs_shares'
  | 'api_get_vfs_blob'
  | 'api_post_vfs_share'
  | 'api_patch_vfs_share'
  | 'api_delete_vfs_share'
  | 'api_delete_vfs_blob'
  | 'api_post_vfs_org_share'
  | 'api_delete_vfs_org_share'
  | 'api_post_vfs_rekey'
  | 'api_get_vfs_share_targets'
  // LLM operations
  | 'llm_model_load'
  | 'llm_prompt_text'
  | 'llm_prompt_multimodal'
  | 'llm_classify_image'
  // AI conversation operations
  | 'api_post_ai_conversation'
  | 'api_get_ai_conversations'
  | 'api_get_ai_conversation'
  | 'api_patch_ai_conversation'
  | 'api_delete_ai_conversation'
  | 'api_post_ai_message'
  | 'api_post_ai_usage'
  | 'api_get_ai_usage'
  | 'api_get_ai_usage_summary';

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
export interface VfsSecureUploadDetail {
  fileSize?: number;
  mimeType?: string;
  failStage?:
    | 'register'
    | 'orchestrator_unavailable'
    | 'stage_attach'
    | 'flush'
    | 'unknown';
}
export interface VfsBlobFlushOperationDetail {
  operationKind?: 'stage' | 'chunk' | 'commit' | 'attach' | 'abandon';
  attempts?: number;
  retryCount?: number;
  failureClass?: 'http_status' | 'network' | 'unknown';
  statusCode?: number;
  retryable?: boolean;
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
export interface ApiPostAuthRegisterDetail {
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
export interface ApiGetAuthOrganizationsDetail {
  organizationCount?: number;
}
export interface ApiDeleteAuthSessionDetail {
  deleted?: boolean;
}

// VFS events
export interface ApiGetVfsKeysDetail {
  hasKeys?: boolean;
}
export interface ApiGetVfsSyncDetail {
  pageSize?: number;
}
export interface ApiGetVfsCrdtSyncDetail {
  pageSize?: number;
}
export interface ApiPostVfsKeysDetail {
  created?: boolean;
}
export interface ApiPostVfsRegisterDetail {
  objectType?: string;
}
export interface ApiGetVfsSharesDetail {
  shareCount?: number;
}
export interface ApiGetVfsBlobDetail {
  blobId?: string;
}
export interface ApiPostVfsShareDetail {
  shareType?: string;
}
export interface ApiPatchVfsShareDetail {
  shareId?: string;
}
export interface ApiDeleteVfsShareDetail {
  deleted?: boolean;
}
export interface ApiDeleteVfsBlobDetail {
  deleted?: boolean;
}
export interface ApiPostVfsOrgShareDetail {
  sourceOrgId?: string;
  targetOrgId?: string;
}
export interface ApiDeleteVfsOrgShareDetail {
  deleted?: boolean;
}
export interface ApiPostVfsRekeyDetail {
  wrapsApplied?: number;
}
export interface ApiGetVfsShareTargetsDetail {
  resultCount?: number;
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

// AI conversation events
export interface ApiPostAiConversationDetail {
  conversationId?: string;
}
export interface ApiGetAiConversationsDetail {
  conversationCount?: number;
}
export interface ApiGetAiConversationDetail {
  messageCount?: number;
}
export interface ApiPatchAiConversationDetail {
  conversationId?: string;
}
export interface ApiDeleteAiConversationDetail {
  deleted?: boolean;
}
export interface ApiPostAiMessageDetail {
  role?: string;
}
export interface ApiPostAiUsageDetail {
  modelId?: string;
  totalTokens?: number;
}
export interface ApiGetAiUsageDetail {
  usageCount?: number;
}
export interface ApiGetAiUsageSummaryDetail {
  totalTokens?: number;
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
  vfs_secure_upload: VfsSecureUploadDetail;
  vfs_blob_flush_operation: VfsBlobFlushOperationDetail;
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
  api_post_auth_register: ApiPostAuthRegisterDetail;
  api_post_auth_logout: ApiPostAuthLogoutDetail;
  api_post_auth_refresh: ApiPostAuthRefreshDetail;
  api_get_auth_sessions: ApiGetAuthSessionsDetail;
  api_get_auth_organizations: ApiGetAuthOrganizationsDetail;
  api_delete_auth_session: ApiDeleteAuthSessionDetail;
  api_get_vfs_keys: ApiGetVfsKeysDetail;
  api_get_vfs_sync: ApiGetVfsSyncDetail;
  api_get_vfs_crdt_sync: ApiGetVfsCrdtSyncDetail;
  api_post_vfs_keys: ApiPostVfsKeysDetail;
  api_post_vfs_register: ApiPostVfsRegisterDetail;
  api_get_vfs_shares: ApiGetVfsSharesDetail;
  api_get_vfs_blob: ApiGetVfsBlobDetail;
  api_post_vfs_share: ApiPostVfsShareDetail;
  api_patch_vfs_share: ApiPatchVfsShareDetail;
  api_delete_vfs_share: ApiDeleteVfsShareDetail;
  api_delete_vfs_blob: ApiDeleteVfsBlobDetail;
  api_post_vfs_org_share: ApiPostVfsOrgShareDetail;
  api_delete_vfs_org_share: ApiDeleteVfsOrgShareDetail;
  api_post_vfs_rekey: ApiPostVfsRekeyDetail;
  api_get_vfs_share_targets: ApiGetVfsShareTargetsDetail;
  llm_model_load: LlmModelLoadDetail;
  llm_prompt_text: LlmPromptTextDetail;
  llm_prompt_multimodal: LlmPromptMultimodalDetail;
  llm_classify_image: LlmClassifyImageDetail;
  api_post_ai_conversation: ApiPostAiConversationDetail;
  api_get_ai_conversations: ApiGetAiConversationsDetail;
  api_get_ai_conversation: ApiGetAiConversationDetail;
  api_patch_ai_conversation: ApiPatchAiConversationDetail;
  api_delete_ai_conversation: ApiDeleteAiConversationDetail;
  api_post_ai_message: ApiPostAiMessageDetail;
  api_post_ai_usage: ApiPostAiUsageDetail;
  api_get_ai_usage: ApiGetAiUsageDetail;
  api_get_ai_usage_summary: ApiGetAiUsageSummaryDetail;
}

// Union of all detail types
export type AnalyticsEventDetail = EventDetailMap[AnalyticsEventSlug];
