import type { Migration } from '@tearleads/db-test-utils';

export const healthTestMigrations: Migration[] = [
  {
    version: 1,
    up: async (adapter) => {
      await adapter.execute(`
        CREATE TABLE IF NOT EXISTS health_exercises (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          created_at INTEGER NOT NULL
        )
      `);

      await adapter.execute(`
        CREATE TABLE IF NOT EXISTS health_weight_readings (
          id TEXT PRIMARY KEY,
          recorded_at INTEGER NOT NULL,
          value_centi INTEGER NOT NULL,
          unit TEXT NOT NULL DEFAULT 'lb',
          note TEXT,
          created_at INTEGER NOT NULL
        )
      `);

      await adapter.execute(`
        CREATE TABLE IF NOT EXISTS health_blood_pressure_readings (
          id TEXT PRIMARY KEY,
          recorded_at INTEGER NOT NULL,
          systolic INTEGER NOT NULL,
          diastolic INTEGER NOT NULL,
          pulse INTEGER,
          note TEXT,
          created_at INTEGER NOT NULL
        )
      `);

      await adapter.execute(`
        CREATE TABLE IF NOT EXISTS health_workout_entries (
          id TEXT PRIMARY KEY,
          performed_at INTEGER NOT NULL,
          exercise_id TEXT NOT NULL REFERENCES health_exercises(id) ON DELETE RESTRICT,
          reps INTEGER NOT NULL,
          weight_centi INTEGER NOT NULL,
          weight_unit TEXT NOT NULL DEFAULT 'lb',
          note TEXT,
          created_at INTEGER NOT NULL
        )
      `);

      await adapter.execute('PRAGMA foreign_keys = ON');
    }
  }
];
