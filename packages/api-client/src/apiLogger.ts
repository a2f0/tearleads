const API_EVENT_SLUGS = [
  'api_get_ping',
  'api_get_admin_redis_keys',
  'api_get_admin_redis_key',
  'api_delete_admin_redis_key',
  'api_get_admin_redis_dbsize',
  'api_get_admin_postgres_info',
  'api_get_admin_postgres_tables',
  'api_get_admin_postgres_columns',
  'api_get_admin_postgres_rows',
  'api_get_admin_users',
  'api_get_admin_user',
  'api_patch_admin_user',
  'api_get_admin_groups',
  'api_get_admin_group',
  'api_post_admin_group',
  'api_put_admin_group',
  'api_delete_admin_group',
  'api_get_admin_group_members',
  'api_post_admin_group_member',
  'api_delete_admin_group_member',
  'api_get_admin_organizations',
  'api_get_admin_organization',
  'api_get_admin_organization_users',
  'api_get_admin_organization_groups',
  'api_post_admin_organization',
  'api_put_admin_organization',
  'api_delete_admin_organization',
  'api_post_auth_login',
  'api_post_auth_register',
  'api_post_auth_logout',
  'api_post_auth_refresh',
  'api_get_auth_sessions',
  'api_delete_auth_session',
  'api_get_vfs_keys',
  'api_post_vfs_keys',
  'api_post_vfs_register',
  'api_get_vfs_shares',
  'api_get_vfs_blob',
  'api_post_vfs_share',
  'api_patch_vfs_share',
  'api_delete_vfs_share',
  'api_delete_vfs_blob',
  'api_post_vfs_org_share',
  'api_delete_vfs_org_share',
  'api_get_vfs_share_targets',
  'api_post_ai_conversation',
  'api_get_ai_conversations',
  'api_get_ai_conversation',
  'api_patch_ai_conversation',
  'api_delete_ai_conversation',
  'api_post_ai_message',
  'api_post_ai_usage',
  'api_get_ai_usage',
  'api_get_ai_usage_summary',
  'api_get_mls_groups',
  'api_get_mls_group',
  'api_post_mls_group',
  'api_patch_mls_group',
  'api_delete_mls_group',
  'api_get_mls_group_members',
  'api_post_mls_group_member',
  'api_delete_mls_group_member',
  'api_get_mls_group_messages',
  'api_post_mls_group_message',
  'api_get_mls_group_state',
  'api_post_mls_group_state',
  'api_get_mls_key_packages_me',
  'api_get_mls_key_packages_user',
  'api_post_mls_key_packages',
  'api_delete_mls_key_package',
  'api_get_mls_welcome_messages',
  'api_post_mls_welcome_ack'
] as const;

export type ApiEventSlug = (typeof API_EVENT_SLUGS)[number];

type ApiEventLogger = (
  eventName: ApiEventSlug,
  durationMs: number,
  success: boolean
) => void | Promise<void>;

let apiEventLogger: ApiEventLogger = () => undefined;

export function setApiEventLogger(logger: ApiEventLogger): void {
  apiEventLogger = logger;
}

export function resetApiEventLogger(): void {
  apiEventLogger = () => undefined;
}

export async function logApiEvent(
  eventName: ApiEventSlug,
  durationMs: number,
  success: boolean
): Promise<void> {
  await apiEventLogger(eventName, durationMs, success);
}
