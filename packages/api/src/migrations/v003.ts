import type { Pool } from 'pg';
import type { Migration } from './types.js';

/**
 * v003: Domain Tables (Notes, Files, AI, MLS, Billing)
 *
 * This migration creates the domain-specific tables using the optimized UUID schema.
 */
export const v003: Migration = {
  version: 3,
  description: 'Domain Data Tables',
  up: async (pool: Pool) => {
    // 1. Core Domain (Notes, Files, Contacts, Playlists)
    await pool.query(`
      CREATE TABLE "notes" (
        "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        "title" TEXT NOT NULL,
        "content" TEXT NOT NULL DEFAULT '',
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        "updated_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        "deleted" BOOLEAN NOT NULL DEFAULT FALSE
      );

      CREATE TABLE "files" (
        "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        "name" TEXT NOT NULL,
        "size" INTEGER NOT NULL,
        "mime_type" TEXT NOT NULL,
        "upload_date" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        "content_hash" TEXT NOT NULL,
        "storage_path" TEXT NOT NULL,
        "thumbnail_path" TEXT,
        "deleted" BOOLEAN NOT NULL DEFAULT FALSE
      );

      CREATE TABLE "contacts" (
        "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        "first_name" TEXT NOT NULL,
        "last_name" TEXT,
        "birthday" TEXT,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        "updated_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        "deleted" BOOLEAN NOT NULL DEFAULT FALSE
      );

      CREATE TABLE "contact_phones" (
        "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        "contact_id" UUID NOT NULL REFERENCES "contacts"("id") ON DELETE CASCADE,
        "phone_number" TEXT NOT NULL,
        "label" TEXT,
        "is_primary" BOOLEAN NOT NULL DEFAULT FALSE
      );

      CREATE TABLE "contact_emails" (
        "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        "contact_id" UUID NOT NULL REFERENCES "contacts"("id") ON DELETE CASCADE,
        "email" TEXT NOT NULL,
        "label" TEXT,
        "is_primary" BOOLEAN NOT NULL DEFAULT FALSE
      );

      CREATE TABLE "playlists" (
        "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        "encrypted_name" TEXT NOT NULL,
        "shuffle_mode" INTEGER NOT NULL DEFAULT 0,
        "media_type" TEXT NOT NULL DEFAULT 'audio',
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        "updated_at" TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE TABLE "albums" (
        "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        "encrypted_name" TEXT NOT NULL,
        "encrypted_description" TEXT,
        "cover_photo_id" UUID REFERENCES "vfs_registry"("id") ON DELETE SET NULL,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        "updated_at" TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE TABLE "emails" (
        "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        "encrypted_subject" TEXT,
        "encrypted_from" TEXT,
        "encrypted_to" JSONB,
        "encrypted_cc" JSONB,
        "encrypted_body_path" TEXT,
        "ciphertext_size" INTEGER NOT NULL DEFAULT 0,
        "received_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        "is_read" BOOLEAN NOT NULL DEFAULT FALSE,
        "is_starred" BOOLEAN NOT NULL DEFAULT FALSE
      );
      CREATE INDEX "emails_received_at_idx" ON "emails" ("received_at");

      CREATE TABLE "contact_groups" (
        "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        "encrypted_name" TEXT,
        "color" TEXT,
        "icon" TEXT
      );

      CREATE TABLE "tags" (
        "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        "encrypted_name" TEXT,
        "color" TEXT,
        "icon" TEXT
      );
    `);

    // 2. AI & MLS
    await pool.query(`
      CREATE TABLE "ai_conversations" (
        "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        "user_id" UUID NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
        "organization_id" UUID REFERENCES "organizations"("id") ON DELETE SET NULL,
        "encrypted_title" TEXT NOT NULL,
        "encrypted_session_key" TEXT NOT NULL,
        "model_id" TEXT,
        "message_count" INTEGER NOT NULL DEFAULT 0,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        "updated_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        "deleted" BOOLEAN NOT NULL DEFAULT FALSE
      );

      CREATE TABLE "ai_messages" (
        "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        "conversation_id" UUID NOT NULL REFERENCES "ai_conversations"("id") ON DELETE CASCADE,
        "role" TEXT NOT NULL CHECK ("role" IN ('system', 'user', 'assistant')),
        "encrypted_content" TEXT NOT NULL,
        "model_id" TEXT,
        "sequence_number" INTEGER NOT NULL,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE TABLE "ai_usage" (
        "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        "conversation_id" UUID REFERENCES "ai_conversations"("id") ON DELETE SET NULL,
        "message_id" UUID REFERENCES "ai_messages"("id") ON DELETE SET NULL,
        "user_id" UUID NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
        "organization_id" UUID REFERENCES "organizations"("id") ON DELETE SET NULL,
        "model_id" TEXT NOT NULL,
        "prompt_tokens" INTEGER NOT NULL,
        "completion_tokens" INTEGER NOT NULL,
        "total_tokens" INTEGER NOT NULL,
        "openrouter_request_id" TEXT,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE TABLE "mls_groups" (
        "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        "group_id_mls" TEXT NOT NULL UNIQUE,
        "name" TEXT NOT NULL,
        "description" TEXT,
        "creator_user_id" UUID NOT NULL REFERENCES "users"("id") ON DELETE RESTRICT,
        "organization_id" UUID REFERENCES "organizations"("id") ON DELETE SET NULL,
        "current_epoch" INTEGER NOT NULL DEFAULT 0,
        "cipher_suite" INTEGER NOT NULL,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        "updated_at" TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE TABLE "mls_group_members" (
        "group_id" UUID NOT NULL REFERENCES "mls_groups"("id") ON DELETE CASCADE,
        "user_id" UUID NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
        "leaf_index" INTEGER,
        "role" TEXT NOT NULL DEFAULT 'member' CHECK ("role" IN ('admin', 'member')),
        "joined_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        "joined_at_epoch" INTEGER NOT NULL,
        "removed_at" TIMESTAMPTZ,
        PRIMARY KEY ("group_id", "user_id")
      );

      CREATE TABLE "mls_key_packages" (
        "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        "user_id" UUID NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
        "key_package_data" TEXT NOT NULL,
        "key_package_ref" TEXT NOT NULL UNIQUE,
        "cipher_suite" INTEGER NOT NULL,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        "consumed_at" TIMESTAMPTZ,
        "consumed_by_group_id" UUID REFERENCES "mls_groups"("id")
      );

      CREATE TABLE "mls_welcome_messages" (
        "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        "group_id" UUID NOT NULL REFERENCES "mls_groups"("id") ON DELETE CASCADE,
        "recipient_user_id" UUID NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
        "key_package_ref" TEXT NOT NULL,
        "welcome_data" TEXT NOT NULL,
        "epoch" INTEGER NOT NULL,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        "consumed_at" TIMESTAMPTZ
      );

      CREATE TABLE "mls_group_state" (
        "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        "group_id" UUID NOT NULL REFERENCES "mls_groups"("id") ON DELETE CASCADE,
        "user_id" UUID NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
        "epoch" INTEGER NOT NULL,
        "encrypted_state" TEXT NOT NULL,
        "state_hash" TEXT NOT NULL,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE UNIQUE INDEX "mls_group_state_group_user_idx" ON "mls_group_state" ("group_id", "user_id");
    `);

    // 3. Billing & Analytics
    await pool.query(`
      CREATE TABLE "organization_billing_accounts" (
        "organization_id" UUID PRIMARY KEY REFERENCES "organizations"("id") ON DELETE CASCADE,
        "revenuecat_app_user_id" TEXT NOT NULL UNIQUE,
        "entitlement_status" TEXT NOT NULL DEFAULT 'inactive' CHECK ("entitlement_status" IN ('inactive', 'trialing', 'active', 'grace_period', 'expired')),
        "active_product_id" TEXT,
        "period_ends_at" TIMESTAMPTZ,
        "will_renew" BOOLEAN,
        "last_webhook_event_id" TEXT,
        "last_webhook_at" TIMESTAMPTZ,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        "updated_at" TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE TABLE "revenuecat_webhook_events" (
        "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        "event_id" TEXT NOT NULL UNIQUE,
        "event_type" TEXT NOT NULL,
        "organization_id" UUID REFERENCES "organizations"("id") ON DELETE SET NULL,
        "revenuecat_app_user_id" TEXT NOT NULL,
        "payload" JSONB NOT NULL,
        "received_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        "processed_at" TIMESTAMPTZ,
        "processing_error" TEXT
      );

      CREATE TABLE "analytics_events" (
        "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        "event_name" TEXT NOT NULL,
        "duration_ms" INTEGER NOT NULL,
        "success" BOOLEAN NOT NULL,
        "timestamp" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        "detail" JSONB
      );
    `);
  }
};
