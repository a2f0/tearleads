import type { Migration } from './types.js';
import { addColumnIfNotExists } from './utils.js';

/**
 * v030: Backfill missing contact_id columns on health tables
 *
 * Existing databases created by v016 do not have contact_id on the health
 * reading tables, but the current schema queries those columns.
 */
export const v030: Migration = {
  version: 30,
  description: 'Backfill health contact columns',
  up: async (adapter) => {
    await addColumnIfNotExists(
      adapter,
      'health_weight_readings',
      'contact_id',
      'TEXT'
    );
    await addColumnIfNotExists(
      adapter,
      'health_blood_pressure_readings',
      'contact_id',
      'TEXT'
    );
    await addColumnIfNotExists(
      adapter,
      'health_workout_entries',
      'contact_id',
      'TEXT'
    );

    await adapter.execute(
      'CREATE INDEX IF NOT EXISTS "health_weight_readings_contact_idx" ON "health_weight_readings" ("contact_id")'
    );
    await adapter.execute(
      'CREATE INDEX IF NOT EXISTS "health_blood_pressure_contact_idx" ON "health_blood_pressure_readings" ("contact_id")'
    );
    await adapter.execute(
      'CREATE INDEX IF NOT EXISTS "health_workout_entries_contact_idx" ON "health_workout_entries" ("contact_id")'
    );
  }
};
