import type { Migration } from './types.js';

/**
 * v031: Add health height readings table
 */
export const v031: Migration = {
  version: 31,
  description: 'Add health height readings table',
  up: async (adapter) => {
    const statements = [
      `CREATE TABLE IF NOT EXISTS "health_height_readings" (
        "id" TEXT PRIMARY KEY NOT NULL,
        "recorded_at" INTEGER NOT NULL,
        "value_centi" INTEGER NOT NULL,
        "unit" TEXT NOT NULL DEFAULT 'in' CHECK("unit" IN ('in', 'cm')),
        "note" TEXT,
        "contact_id" TEXT,
        "created_at" INTEGER NOT NULL
      )`,
      `CREATE INDEX IF NOT EXISTS "health_height_readings_recorded_at_idx" ON "health_height_readings" ("recorded_at")`,
      `CREATE INDEX IF NOT EXISTS "health_height_readings_contact_idx" ON "health_height_readings" ("contact_id")`
    ];

    await adapter.executeMany(statements);
  }
};
