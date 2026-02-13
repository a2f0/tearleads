import type { Migration } from './types';

/**
 * v016: Add health tracking tables
 *
 * Adds local persistence tables for:
 * - exercises
 * - weight readings
 * - blood pressure readings
 * - workout entries
 */
export const v016: Migration = {
  version: 16,
  description: 'Add health tracking tables',
  up: async (adapter) => {
    const statements = [
      `CREATE TABLE IF NOT EXISTS "health_exercises" (
        "id" TEXT PRIMARY KEY NOT NULL,
        "name" TEXT NOT NULL,
        "created_at" INTEGER NOT NULL
      )`,
      `CREATE INDEX IF NOT EXISTS "health_exercises_name_idx" ON "health_exercises" ("name")`,
      `CREATE TABLE IF NOT EXISTS "health_weight_readings" (
        "id" TEXT PRIMARY KEY NOT NULL,
        "recorded_at" INTEGER NOT NULL,
        "value_centi" INTEGER NOT NULL,
        "unit" TEXT NOT NULL DEFAULT 'lb' CHECK("unit" IN ('lb', 'kg')),
        "note" TEXT,
        "created_at" INTEGER NOT NULL
      )`,
      `CREATE INDEX IF NOT EXISTS "health_weight_readings_recorded_at_idx" ON "health_weight_readings" ("recorded_at")`,
      `CREATE TABLE IF NOT EXISTS "health_blood_pressure_readings" (
        "id" TEXT PRIMARY KEY NOT NULL,
        "recorded_at" INTEGER NOT NULL,
        "systolic" INTEGER NOT NULL,
        "diastolic" INTEGER NOT NULL,
        "pulse" INTEGER,
        "note" TEXT,
        "created_at" INTEGER NOT NULL
      )`,
      `CREATE INDEX IF NOT EXISTS "health_blood_pressure_recorded_at_idx" ON "health_blood_pressure_readings" ("recorded_at")`,
      `CREATE TABLE IF NOT EXISTS "health_workout_entries" (
        "id" TEXT PRIMARY KEY NOT NULL,
        "performed_at" INTEGER NOT NULL,
        "exercise_id" TEXT NOT NULL REFERENCES "health_exercises"("id") ON DELETE RESTRICT,
        "reps" INTEGER NOT NULL,
        "weight_centi" INTEGER NOT NULL,
        "weight_unit" TEXT NOT NULL DEFAULT 'lb' CHECK("weight_unit" IN ('lb', 'kg')),
        "note" TEXT,
        "created_at" INTEGER NOT NULL
      )`,
      `CREATE INDEX IF NOT EXISTS "health_workout_entries_performed_at_idx" ON "health_workout_entries" ("performed_at")`,
      `CREATE INDEX IF NOT EXISTS "health_workout_entries_exercise_idx" ON "health_workout_entries" ("exercise_id")`
    ];

    await adapter.executeMany(statements);
  }
};
