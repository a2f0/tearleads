import type { TableDefinition } from './types.js';

export const healthWeightReadingsTable: TableDefinition = {
  name: 'health_weight_readings',
  propertyName: 'healthWeightReadings',
  comment:
    'Health weight readings table for storing body weight measurements.\nValues are stored as centi-units to preserve decimal precision.',
  columns: {
    id: {
      type: 'text',
      sqlName: 'id',
      primaryKey: true
    },
    recordedAt: {
      type: 'timestamp',
      sqlName: 'recorded_at',
      notNull: true
    },
    valueCenti: {
      type: 'integer',
      sqlName: 'value_centi',
      notNull: true
    },
    unit: {
      type: 'text',
      sqlName: 'unit',
      notNull: true,
      defaultValue: 'lb',
      enumValues: ['lb', 'kg'] as const
    },
    note: {
      type: 'text',
      sqlName: 'note'
    },
    createdAt: {
      type: 'timestamp',
      sqlName: 'created_at',
      notNull: true
    }
  },
  indexes: [
    { name: 'health_weight_readings_recorded_at_idx', columns: ['recordedAt'] }
  ]
};

/**
 * Health blood pressure readings table for systolic/diastolic tracking.
 */
export const healthBloodPressureReadingsTable: TableDefinition = {
  name: 'health_blood_pressure_readings',
  propertyName: 'healthBloodPressureReadings',
  comment:
    'Health blood pressure readings table for systolic/diastolic tracking.',
  columns: {
    id: {
      type: 'text',
      sqlName: 'id',
      primaryKey: true
    },
    recordedAt: {
      type: 'timestamp',
      sqlName: 'recorded_at',
      notNull: true
    },
    systolic: {
      type: 'integer',
      sqlName: 'systolic',
      notNull: true
    },
    diastolic: {
      type: 'integer',
      sqlName: 'diastolic',
      notNull: true
    },
    pulse: {
      type: 'integer',
      sqlName: 'pulse'
    },
    note: {
      type: 'text',
      sqlName: 'note'
    },
    createdAt: {
      type: 'timestamp',
      sqlName: 'created_at',
      notNull: true
    }
  },
  indexes: [
    {
      name: 'health_blood_pressure_recorded_at_idx',
      columns: ['recordedAt']
    }
  ]
};

/**
 * Health workout entries table for exercise, reps, and weight tracking.
 * Weight values are stored as centi-units to preserve decimal precision.
 */
export const healthWorkoutEntriesTable: TableDefinition = {
  name: 'health_workout_entries',
  propertyName: 'healthWorkoutEntries',
  comment:
    'Health workout entries table for exercise, reps, and weight tracking.\nWeight values are stored as centi-units to preserve decimal precision.',
  columns: {
    id: {
      type: 'text',
      sqlName: 'id',
      primaryKey: true
    },
    performedAt: {
      type: 'timestamp',
      sqlName: 'performed_at',
      notNull: true
    },
    exerciseId: {
      type: 'text',
      sqlName: 'exercise_id',
      notNull: true,
      references: {
        table: 'health_exercises',
        column: 'id',
        onDelete: 'restrict'
      }
    },
    reps: {
      type: 'integer',
      sqlName: 'reps',
      notNull: true
    },
    weightCenti: {
      type: 'integer',
      sqlName: 'weight_centi',
      notNull: true
    },
    weightUnit: {
      type: 'text',
      sqlName: 'weight_unit',
      notNull: true,
      defaultValue: 'lb',
      enumValues: ['lb', 'kg'] as const
    },
    note: {
      type: 'text',
      sqlName: 'note'
    },
    createdAt: {
      type: 'timestamp',
      sqlName: 'created_at',
      notNull: true
    }
  },
  indexes: [
    {
      name: 'health_workout_entries_performed_at_idx',
      columns: ['performedAt']
    },
    { name: 'health_workout_entries_exercise_idx', columns: ['exerciseId'] }
  ]
};

export const collabHealthTables: TableDefinition[] = [
  healthWeightReadingsTable,
  healthBloodPressureReadingsTable,
  healthWorkoutEntriesTable
];
