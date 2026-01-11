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
  llm_model_load: LlmModelLoadDetail;
  llm_prompt_text: LlmPromptTextDetail;
  llm_prompt_multimodal: LlmPromptMultimodalDetail;
  llm_classify_image: LlmClassifyImageDetail;
}

// Union of all detail types
export type AnalyticsEventDetail = EventDetailMap[AnalyticsEventSlug];
