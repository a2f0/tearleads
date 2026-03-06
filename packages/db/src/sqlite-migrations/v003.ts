import type { Migration } from './types';

/**
 * v003: Create notes table
 *
 * Adds a table for storing user notes with markdown content.
 */
export const v003: Migration = {
  version: 3,
  description: 'Create notes table',
  up: async (adapter) => {
    const statements = [
      `CREATE TABLE IF NOT EXISTS "notes" (
        "id" TEXT PRIMARY KEY NOT NULL,
        "title" TEXT NOT NULL,
        "content" TEXT DEFAULT '' NOT NULL,
        "created_at" INTEGER NOT NULL,
        "updated_at" INTEGER NOT NULL,
        "deleted" INTEGER DEFAULT 0 NOT NULL
      )`,
      `CREATE INDEX IF NOT EXISTS "notes_updated_at_idx" ON "notes" ("updated_at")`,
      `CREATE INDEX IF NOT EXISTS "notes_title_idx" ON "notes" ("title")`
    ];

    await adapter.executeMany(statements);
  }
};
