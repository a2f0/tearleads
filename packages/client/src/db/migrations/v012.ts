import type { Migration } from './types';

/**
 * v012: Add local calendar events table
 *
 * Stores local calendar events used by the calendar window UI.
 */
export const v012: Migration = {
  version: 12,
  description: 'Add calendar_events table',
  up: async (adapter) => {
    const statements = [
      `CREATE TABLE IF NOT EXISTS "calendar_events" (
        "id" TEXT PRIMARY KEY NOT NULL,
        "calendar_name" TEXT NOT NULL,
        "title" TEXT NOT NULL,
        "start_at" INTEGER NOT NULL,
        "end_at" INTEGER,
        "created_at" INTEGER NOT NULL,
        "updated_at" INTEGER NOT NULL
      )`,
      `CREATE INDEX IF NOT EXISTS "calendar_events_calendar_start_idx" ON "calendar_events" ("calendar_name", "start_at")`,
      `CREATE INDEX IF NOT EXISTS "calendar_events_start_idx" ON "calendar_events" ("start_at")`
    ];

    await adapter.executeMany(statements);
  }
};
