import {
  type AnyPgColumn,
  index,
  integer,
  pgTable,
  text,
  timestamp
} from 'drizzle-orm/pg-core';

/**
 * Health exercises table for workout exercise selection.
 * Supports hierarchical exercise categories via parentId.
 */
export const healthExercises = pgTable(
  'health_exercises',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    parentId: text('parent_id').references(
      (): AnyPgColumn => healthExercises.id,
      { onDelete: 'restrict' }
    ),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull()
  },
  (table) => [
    index('health_exercises_name_idx').on(table.name),
    index('health_exercises_parent_idx').on(table.parentId)
  ]
);

/**
 * Health weight readings table for storing body weight measurements.
 * Values are stored as centi-units to preserve decimal precision.
 */
export const healthWeightReadings = pgTable(
  'health_weight_readings',
  {
    id: text('id').primaryKey(),
    recordedAt: timestamp('recorded_at', { withTimezone: true }).notNull(),
    valueCenti: integer('value_centi').notNull(),
    unit: text('unit', {
      enum: ['lb', 'kg']
    })
      .notNull()
      .default('lb'),
    note: text('note'),
    contactId: text('contact_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull()
  },
  (table) => [
    index('health_weight_readings_recorded_at_idx').on(table.recordedAt),
    index('health_weight_readings_contact_idx').on(table.contactId)
  ]
);

/**
 * Health height readings table for storing body height measurements.
 * Values are stored as centi-units to preserve decimal precision.
 */
export const healthHeightReadings = pgTable(
  'health_height_readings',
  {
    id: text('id').primaryKey(),
    recordedAt: timestamp('recorded_at', { withTimezone: true }).notNull(),
    valueCenti: integer('value_centi').notNull(),
    unit: text('unit', {
      enum: ['in', 'cm']
    })
      .notNull()
      .default('in'),
    note: text('note'),
    contactId: text('contact_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull()
  },
  (table) => [
    index('health_height_readings_recorded_at_idx').on(table.recordedAt),
    index('health_height_readings_contact_idx').on(table.contactId)
  ]
);

/**
 * Health blood pressure readings table for systolic/diastolic tracking.
 */
export const healthBloodPressureReadings = pgTable(
  'health_blood_pressure_readings',
  {
    id: text('id').primaryKey(),
    recordedAt: timestamp('recorded_at', { withTimezone: true }).notNull(),
    systolic: integer('systolic').notNull(),
    diastolic: integer('diastolic').notNull(),
    pulse: integer('pulse'),
    note: text('note'),
    contactId: text('contact_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull()
  },
  (table) => [
    index('health_blood_pressure_recorded_at_idx').on(table.recordedAt),
    index('health_blood_pressure_contact_idx').on(table.contactId)
  ]
);

/**
 * Health workout entries table for exercise, reps, and weight tracking.
 * Weight values are stored as centi-units to preserve decimal precision.
 */
export const healthWorkoutEntries = pgTable(
  'health_workout_entries',
  {
    id: text('id').primaryKey(),
    performedAt: timestamp('performed_at', { withTimezone: true }).notNull(),
    exerciseId: text('exercise_id')
      .notNull()
      .references(() => healthExercises.id, { onDelete: 'restrict' }),
    reps: integer('reps').notNull(),
    weightCenti: integer('weight_centi').notNull(),
    weightUnit: text('weight_unit', {
      enum: ['lb', 'kg']
    })
      .notNull()
      .default('lb'),
    note: text('note'),
    contactId: text('contact_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull()
  },
  (table) => [
    index('health_workout_entries_performed_at_idx').on(table.performedAt),
    index('health_workout_entries_exercise_idx').on(table.exerciseId),
    index('health_workout_entries_contact_idx').on(table.contactId)
  ]
);
