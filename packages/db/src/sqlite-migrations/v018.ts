import type { Migration } from './types';

/**
 * v018: Add vehicles table
 *
 * Adds local persistence for vehicle inventory records.
 */
export const v018: Migration = {
  version: 18,
  description: 'Add vehicles table',
  up: async (adapter) => {
    const statements = [
      `CREATE TABLE IF NOT EXISTS "vehicles" (
        "id" TEXT PRIMARY KEY NOT NULL,
        "make" TEXT NOT NULL,
        "model" TEXT NOT NULL,
        "year" INTEGER,
        "color" TEXT,
        "created_at" INTEGER NOT NULL,
        "updated_at" INTEGER NOT NULL,
        "deleted" INTEGER NOT NULL DEFAULT 0 CHECK("deleted" IN (0, 1))
      )`,
      `CREATE INDEX IF NOT EXISTS "vehicles_updated_at_idx" ON "vehicles" ("updated_at")`,
      `CREATE INDEX IF NOT EXISTS "vehicles_make_model_idx" ON "vehicles" ("make", "model")`,
      `CREATE INDEX IF NOT EXISTS "vehicles_year_idx" ON "vehicles" ("year")`,
      `CREATE INDEX IF NOT EXISTS "vehicles_deleted_idx" ON "vehicles" ("deleted")`
    ];

    await adapter.executeMany(statements);
  }
};
