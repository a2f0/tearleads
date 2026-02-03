import type { Pool } from 'pg';
import type { Migration } from './types.js';

/**
 * v015: Add AI conversation and usage tracking tables
 *
 * Creates:
 * - ai_conversations: Encrypted conversation metadata
 * - ai_messages: Encrypted message content
 * - ai_usage: Token usage tracking for billing/analytics
 */
export const v015: Migration = {
  version: 15,
  description: 'Add AI conversation and usage tracking tables',
  up: async (pool: Pool) => {
    await pool.query('BEGIN');
    try {
      // AI conversations - encrypted conversation metadata
      const createAiConversationsTable = `CREATE TABLE IF NOT EXISTS "ai_conversations" (
        "id" TEXT PRIMARY KEY,
        "user_id" TEXT NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
        "organization_id" TEXT REFERENCES "organizations"("id") ON DELETE SET NULL,
        "encrypted_title" TEXT NOT NULL,
        "encrypted_session_key" TEXT NOT NULL,
        "model_id" TEXT,
        "message_count" INTEGER NOT NULL DEFAULT 0,
        "created_at" TIMESTAMPTZ NOT NULL,
        "updated_at" TIMESTAMPTZ NOT NULL,
        "deleted" BOOLEAN NOT NULL DEFAULT FALSE
      )`;
      const createAiConversationsUserIndex =
        'CREATE INDEX IF NOT EXISTS "ai_conversations_user_idx" ON "ai_conversations" ("user_id", "deleted", "updated_at" DESC)';
      const createAiConversationsOrgIndex =
        'CREATE INDEX IF NOT EXISTS "ai_conversations_org_idx" ON "ai_conversations" ("organization_id") WHERE "organization_id" IS NOT NULL';

      // AI messages - encrypted message content
      const createAiMessagesTable = `CREATE TABLE IF NOT EXISTS "ai_messages" (
        "id" TEXT PRIMARY KEY,
        "conversation_id" TEXT NOT NULL REFERENCES "ai_conversations"("id") ON DELETE CASCADE,
        "role" TEXT NOT NULL CHECK ("role" IN ('system', 'user', 'assistant')),
        "encrypted_content" TEXT NOT NULL,
        "model_id" TEXT,
        "sequence_number" INTEGER NOT NULL,
        "created_at" TIMESTAMPTZ NOT NULL
      )`;
      const createAiMessagesConversationIndex =
        'CREATE INDEX IF NOT EXISTS "ai_messages_conversation_idx" ON "ai_messages" ("conversation_id", "sequence_number")';

      // AI usage - token tracking for billing/analytics (plaintext)
      const createAiUsageTable = `CREATE TABLE IF NOT EXISTS "ai_usage" (
        "id" TEXT PRIMARY KEY,
        "conversation_id" TEXT REFERENCES "ai_conversations"("id") ON DELETE SET NULL,
        "message_id" TEXT REFERENCES "ai_messages"("id") ON DELETE SET NULL,
        "user_id" TEXT NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
        "organization_id" TEXT REFERENCES "organizations"("id") ON DELETE SET NULL,
        "model_id" TEXT NOT NULL,
        "prompt_tokens" INTEGER NOT NULL,
        "completion_tokens" INTEGER NOT NULL,
        "total_tokens" INTEGER NOT NULL,
        "openrouter_request_id" TEXT,
        "created_at" TIMESTAMPTZ NOT NULL
      )`;
      const createAiUsageUserIndex =
        'CREATE INDEX IF NOT EXISTS "ai_usage_user_idx" ON "ai_usage" ("user_id", "created_at" DESC)';
      const createAiUsageOrgIndex =
        'CREATE INDEX IF NOT EXISTS "ai_usage_org_idx" ON "ai_usage" ("organization_id", "created_at" DESC) WHERE "organization_id" IS NOT NULL';
      const createAiUsageConversationIndex =
        'CREATE INDEX IF NOT EXISTS "ai_usage_conversation_idx" ON "ai_usage" ("conversation_id") WHERE "conversation_id" IS NOT NULL';

      // Execute all statements
      await pool.query(createAiConversationsTable);
      await pool.query(createAiConversationsUserIndex);
      await pool.query(createAiConversationsOrgIndex);

      await pool.query(createAiMessagesTable);
      await pool.query(createAiMessagesConversationIndex);

      await pool.query(createAiUsageTable);
      await pool.query(createAiUsageUserIndex);
      await pool.query(createAiUsageOrgIndex);
      await pool.query(createAiUsageConversationIndex);

      await pool.query('COMMIT');
    } catch (e) {
      await pool.query('ROLLBACK');
      throw e;
    }
  }
};
