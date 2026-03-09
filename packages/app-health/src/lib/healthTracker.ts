import {
  type Database,
  healthBloodPressureReadings,
  healthExercises,
  healthWeightReadings,
  healthWorkoutEntries
} from '@tearleads/db/sqlite';
import { asc, desc, eq } from 'drizzle-orm';

import { DEFAULT_EXERCISES } from './defaultExercises.js';
import type {
  BloodPressureReading,
  CreateHealthTrackerOptions,
  Exercise,
  HealthTracker,
  WeightReading,
  WorkoutEntry
} from './healthTrackerTypes.js';
import {
  createSlug,
  fromCentiWeight,
  normalizeNonNegativeNumber,
  normalizeOptionalText,
  normalizePositiveInteger,
  normalizePositiveNumber,
  normalizeRequiredText,
  normalizeTimestamp,
  normalizeWeightUnit,
  toCentiWeight,
  toCentiWeightAllowZero,
  toIsoTimestamp
} from './healthTrackerUtils.js';

export type {
  BloodPressureReading,
  CreateBloodPressureReadingInput,
  CreateExerciseInput,
  CreateHealthTrackerOptions,
  CreateWeightReadingInput,
  CreateWorkoutEntryInput,
  Exercise,
  HealthTracker,
  WeightReading,
  WeightUnit,
  WorkoutEntry
} from './healthTrackerTypes.js';

export const createHealthTracker = (
  db: Database,
  options: CreateHealthTrackerOptions = {}
): HealthTracker => {
  const now = options.now ?? (() => new Date());
  const generateId =
    options.createId ??
    ((prefix: string): string => `${prefix}_${globalThis.crypto.randomUUID()}`);

  const createId = (prefix: string): string =>
    normalizeRequiredText(generateId(prefix), `${prefix} id`);

  let defaultsSeeded = false;

  const ensureDefaultExercises = async (): Promise<void> => {
    if (defaultsSeeded) {
      return;
    }

    const createdAtBase = now();
    const parentExercises = DEFAULT_EXERCISES.filter((e) => !e.parentId);
    const childExercises = DEFAULT_EXERCISES.filter((e) => e.parentId);

    await db
      .insert(healthExercises)
      .values(
        parentExercises.map((exercise, index) => ({
          id: exercise.id,
          name: exercise.name,
          parentId: null,
          createdAt: new Date(createdAtBase.getTime() + index)
        }))
      )
      .onConflictDoNothing();

    await db
      .insert(healthExercises)
      .values(
        childExercises.map((exercise, index) => ({
          id: exercise.id,
          name: exercise.name,
          parentId: exercise.parentId ?? null,
          createdAt: new Date(
            createdAtBase.getTime() + parentExercises.length + index
          )
        }))
      )
      .onConflictDoNothing();

    defaultsSeeded = true;
  };

  const fetchExercisesWithParentNames = async (): Promise<Exercise[]> => {
    const rows = await db
      .select({
        id: healthExercises.id,
        name: healthExercises.name,
        parentId: healthExercises.parentId
      })
      .from(healthExercises)
      .orderBy(asc(healthExercises.createdAt), asc(healthExercises.name));

    const exerciseMap = new Map<string, string>();
    for (const row of rows) {
      exerciseMap.set(row.id, row.name);
    }

    return rows.map((row) => {
      const exercise: Exercise = {
        id: row.id,
        name: row.name
      };
      if (row.parentId !== null) {
        exercise.parentId = row.parentId;
        const parentName = exerciseMap.get(row.parentId);
        if (parentName !== undefined) {
          exercise.parentName = parentName;
        }
      }
      return exercise;
    });
  };

  return {
    listExercises: async () => {
      await ensureDefaultExercises();
      return fetchExercisesWithParentNames();
    },
    listParentExercises: async () => {
      await ensureDefaultExercises();
      const allExercises = await fetchExercisesWithParentNames();
      return allExercises.filter((e) => e.parentId === undefined);
    },
    listChildExercises: async (parentId: string) => {
      await ensureDefaultExercises();
      const normalizedParentId = normalizeRequiredText(parentId, 'parentId');
      const allExercises = await fetchExercisesWithParentNames();
      return allExercises.filter((e) => e.parentId === normalizedParentId);
    },
    getExerciseHierarchy: async () => {
      await ensureDefaultExercises();
      const allExercises = await fetchExercisesWithParentNames();

      const hierarchy = new Map<string, Exercise[]>();
      const parents = allExercises.filter((e) => e.parentId === undefined);

      for (const parent of parents) {
        const children = allExercises.filter((e) => e.parentId === parent.id);
        hierarchy.set(parent.id, children);
      }

      return hierarchy;
    },
    addExercise: async (input) => {
      await ensureDefaultExercises();

      const name = normalizeRequiredText(input.name, 'name');
      const providedId = normalizeOptionalText(input.id);
      const parentId = normalizeOptionalText(input.parentId);
      const generatedId = createSlug(name);
      const exerciseId =
        providedId ??
        (generatedId.length > 0 ? generatedId : createId('exercise'));

      const existingRows = await db
        .select({ id: healthExercises.id })
        .from(healthExercises)
        .where(eq(healthExercises.id, exerciseId))
        .limit(1);
      if (existingRows.length > 0) {
        throw new Error(`Exercise with id "${exerciseId}" already exists`);
      }

      let parentName: string | undefined;
      if (parentId !== undefined) {
        const parentRows = await db
          .select({ id: healthExercises.id, name: healthExercises.name })
          .from(healthExercises)
          .where(eq(healthExercises.id, parentId))
          .limit(1);
        const parent = parentRows[0];
        if (parent === undefined) {
          throw new Error(`Parent exercise with id "${parentId}" not found`);
        }
        parentName = parent.name;
      }

      const createdAt = now();
      await db.insert(healthExercises).values({
        id: exerciseId,
        name,
        parentId: parentId ?? null,
        createdAt
      });

      const exercise: Exercise = { id: exerciseId, name };
      if (parentId !== undefined) {
        exercise.parentId = parentId;
      }
      if (parentName !== undefined) {
        exercise.parentName = parentName;
      }
      return exercise;
    },
    listWeightReadings: async () => {
      const rows = await db
        .select({
          id: healthWeightReadings.id,
          recordedAt: healthWeightReadings.recordedAt,
          valueCenti: healthWeightReadings.valueCenti,
          unit: healthWeightReadings.unit,
          note: healthWeightReadings.note
        })
        .from(healthWeightReadings)
        .orderBy(
          desc(healthWeightReadings.recordedAt),
          desc(healthWeightReadings.createdAt)
        );

      return rows.map((row) => {
        const reading: WeightReading = {
          id: row.id,
          recordedAt: toIsoTimestamp(row.recordedAt),
          value: fromCentiWeight(row.valueCenti),
          unit: normalizeWeightUnit(row.unit, 'unit')
        };

        if (row.note !== null) {
          reading.note = row.note;
        }

        return reading;
      });
    },
    addWeightReading: async (input) => {
      const recordedAt = normalizeTimestamp(input.recordedAt, 'recordedAt');
      const unit = normalizeWeightUnit(input.unit, 'unit');
      const note = normalizeOptionalText(input.note);
      const id = createId('weight');
      const createdAt = now();

      await db.insert(healthWeightReadings).values({
        id,
        recordedAt,
        valueCenti: toCentiWeight(input.value, 'value'),
        unit,
        note: note ?? null,
        createdAt
      });

      const reading: WeightReading = {
        id,
        recordedAt: toIsoTimestamp(recordedAt),
        value: normalizePositiveNumber(input.value, 'value'),
        unit
      };

      if (note !== undefined) {
        reading.note = note;
      }

      return reading;
    },
    listBloodPressureReadings: async () => {
      const rows = await db
        .select({
          id: healthBloodPressureReadings.id,
          recordedAt: healthBloodPressureReadings.recordedAt,
          systolic: healthBloodPressureReadings.systolic,
          diastolic: healthBloodPressureReadings.diastolic,
          pulse: healthBloodPressureReadings.pulse,
          note: healthBloodPressureReadings.note
        })
        .from(healthBloodPressureReadings)
        .orderBy(
          desc(healthBloodPressureReadings.recordedAt),
          desc(healthBloodPressureReadings.createdAt)
        );

      return rows.map((row) => {
        const reading: BloodPressureReading = {
          id: row.id,
          recordedAt: toIsoTimestamp(row.recordedAt),
          systolic: row.systolic,
          diastolic: row.diastolic
        };

        if (row.pulse !== null) {
          reading.pulse = row.pulse;
        }

        if (row.note !== null) {
          reading.note = row.note;
        }

        return reading;
      });
    },
    addBloodPressureReading: async (input) => {
      const systolic = normalizePositiveInteger(input.systolic, 'systolic');
      const diastolic = normalizePositiveInteger(input.diastolic, 'diastolic');
      if (systolic <= diastolic) {
        throw new Error('systolic must be greater than diastolic');
      }

      const pulse =
        input.pulse === undefined
          ? undefined
          : normalizePositiveInteger(input.pulse, 'pulse');
      const note = normalizeOptionalText(input.note);
      const recordedAt = normalizeTimestamp(input.recordedAt, 'recordedAt');
      const id = createId('blood_pressure');
      const createdAt = now();

      await db.insert(healthBloodPressureReadings).values({
        id,
        recordedAt,
        systolic,
        diastolic,
        pulse: pulse ?? null,
        note: note ?? null,
        createdAt
      });

      const reading: BloodPressureReading = {
        id,
        recordedAt: toIsoTimestamp(recordedAt),
        systolic,
        diastolic
      };

      if (pulse !== undefined) {
        reading.pulse = pulse;
      }

      if (note !== undefined) {
        reading.note = note;
      }

      return reading;
    },
    listWorkoutEntries: async () => {
      const rows = await db
        .select({
          id: healthWorkoutEntries.id,
          performedAt: healthWorkoutEntries.performedAt,
          exerciseId: healthWorkoutEntries.exerciseId,
          exerciseName: healthExercises.name,
          reps: healthWorkoutEntries.reps,
          weightCenti: healthWorkoutEntries.weightCenti,
          weightUnit: healthWorkoutEntries.weightUnit,
          note: healthWorkoutEntries.note
        })
        .from(healthWorkoutEntries)
        .innerJoin(
          healthExercises,
          eq(healthWorkoutEntries.exerciseId, healthExercises.id)
        )
        .orderBy(
          desc(healthWorkoutEntries.performedAt),
          desc(healthWorkoutEntries.createdAt)
        );

      return rows.map((row) => {
        const entry: WorkoutEntry = {
          id: row.id,
          performedAt: toIsoTimestamp(row.performedAt),
          exerciseId: row.exerciseId,
          exerciseName: row.exerciseName,
          reps: row.reps,
          weight: fromCentiWeight(row.weightCenti),
          weightUnit: normalizeWeightUnit(row.weightUnit, 'weightUnit')
        };

        if (row.note !== null) {
          entry.note = row.note;
        }

        return entry;
      });
    },
    addWorkoutEntry: async (input) => {
      await ensureDefaultExercises();

      const exerciseId = normalizeRequiredText(input.exerciseId, 'exerciseId');
      const exerciseRows = await db
        .select({ id: healthExercises.id, name: healthExercises.name })
        .from(healthExercises)
        .where(eq(healthExercises.id, exerciseId))
        .limit(1);
      const exercise = exerciseRows[0];
      if (exercise === undefined) {
        throw new Error(`Unknown exercise id "${exerciseId}"`);
      }

      const performedAt = normalizeTimestamp(input.performedAt, 'performedAt');
      const reps = normalizePositiveInteger(input.reps, 'reps');
      const weight = normalizeNonNegativeNumber(input.weight, 'weight');
      const weightUnit = normalizeWeightUnit(input.weightUnit, 'weightUnit');
      const note = normalizeOptionalText(input.note);
      const id = createId('workout');
      const createdAt = now();

      await db.insert(healthWorkoutEntries).values({
        id,
        performedAt,
        exerciseId: exercise.id,
        reps,
        weightCenti: toCentiWeightAllowZero(weight, 'weight'),
        weightUnit,
        note: note ?? null,
        createdAt
      });

      const workoutEntry: WorkoutEntry = {
        id,
        performedAt: toIsoTimestamp(performedAt),
        exerciseId: exercise.id,
        exerciseName: exercise.name,
        reps,
        weight,
        weightUnit
      };

      if (note !== undefined) {
        workoutEntry.note = note;
      }

      return workoutEntry;
    }
  };
};
