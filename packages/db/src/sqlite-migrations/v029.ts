import type { Migration } from './types';

/**
 * v029: Add AI conversations and messages tables
 *
 * Creates:
 * - ai_conversations: Encrypted conversation metadata (extends vfs_registry)
 * - ai_messages: Encrypted message content (child of ai_conversations)
 */
export const v029: Migration = {
  version: 29,
  description: 'Add AI conversations and messages tables',
  up: async (adapter) => {
    const statements = [
      `CREATE TABLE IF NOT EXISTS "ai_conversations" (
        "id" TEXT PRIMARY KEY REFERENCES "vfs_registry"("id") ON DELETE CASCADE,
        "encrypted_title" TEXT NOT NULL,
        "model_id" TEXT,
        "message_count" INTEGER NOT NULL DEFAULT 0,
        "created_at" INTEGER NOT NULL,
        "updated_at" INTEGER NOT NULL
      )`,
      `CREATE INDEX IF NOT EXISTS "ai_conversations_updated_idx" ON "ai_conversations" ("updated_at")`,
      `CREATE TABLE IF NOT EXISTS "ai_messages" (
        "id" TEXT PRIMARY KEY,
        "conversation_id" TEXT NOT NULL REFERENCES "ai_conversations"("id") ON DELETE CASCADE,
        "role" TEXT NOT NULL CHECK ("role" IN ('system', 'user', 'assistant')),
        "encrypted_content" TEXT NOT NULL,
        "model_id" TEXT,
        "sequence_number" INTEGER NOT NULL,
        "created_at" INTEGER NOT NULL
      )`,
      `CREATE INDEX IF NOT EXISTS "ai_messages_conversation_idx" ON "ai_messages" ("conversation_id", "sequence_number")`
    ];

    await adapter.executeMany(statements);
  }
};
