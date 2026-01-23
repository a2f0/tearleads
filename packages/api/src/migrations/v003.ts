import type { Pool } from 'pg';
import type { Migration } from './types.js';

/**
 * v003: Create notes table
 *
 * Adds a table for storing user notes with markdown content.
 */
export const v003: Migration = {
  version: 3,
  description: 'Create notes table',
  up: async (pool: Pool) => {
    const statements = [
      `CREATE TABLE IF NOT EXISTS "notes" (
        "id" TEXT PRIMARY KEY,
        "title" TEXT NOT NULL,
        "content" TEXT NOT NULL DEFAULT '',
        "created_at" TIMESTAMPTZ NOT NULL,
        "updated_at" TIMESTAMPTZ NOT NULL,
        "deleted" BOOLEAN NOT NULL DEFAULT FALSE
      )`,
      'CREATE INDEX IF NOT EXISTS "notes_updated_at_idx" ON "notes" ("updated_at")',
      'CREATE INDEX IF NOT EXISTS "notes_title_idx" ON "notes" ("title")'
    ];

    for (const sql of statements) {
      await pool.query(sql);
    }
  }
};
