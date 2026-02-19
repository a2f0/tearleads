import {
  healthBloodPressureReadings,
  healthWorkoutEntries
} from '@tearleads/db/sqlite';
import type { TestDatabaseContext } from '@tearleads/db-test-utils';
import { withRealDatabase } from '@tearleads/db-test-utils';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { healthTestMigrations } from '../test/healthTestMigrations.js';

import { DEFAULT_EXERCISE_IDS } from './defaultExercises.js';
import { createHealthTracker } from './healthTracker.js';

const createDeterministicId = (): ((prefix: string) => string) => {
  let sequence = 1;
  return (prefix: string): string => {
    const id = `${prefix}_${String(sequence).padStart(4, '0')}`;
    sequence += 1;
    return id;
  };
};

const requireValue = <T>(value: T | undefined): T => {
  if (value === undefined) {
    throw new Error('Expected value to be defined in test');
  }

  return value;
};

const withHealthDatabase = async <T>(
  callback: (context: TestDatabaseContext) => Promise<T>
): Promise<T> =>
  withRealDatabase(callback, {
    migrations: healthTestMigrations
  });

describe('createHealthTracker blood pressure and workouts', () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    warnSpy.mockRestore();
  });

  it('adds blood pressure readings and supports optional fields', async () => {
    await withHealthDatabase(async ({ db }) => {
      const tracker = createHealthTracker(db, {
        createId: createDeterministicId(),
        now: () => new Date('2026-02-13T09:31:00.000Z')
      });

      const reading = await tracker.addBloodPressureReading({
        recordedAt: '2026-02-12T08:00:00.000Z',
        systolic: 122,
        diastolic: 79,
        pulse: 61,
        note: ' seated '
      });

      expect(reading).toEqual({
        id: 'blood_pressure_0001',
        recordedAt: '2026-02-12T08:00:00.000Z',
        systolic: 122,
        diastolic: 79,
        pulse: 61,
        note: 'seated'
      });

      const noOptional = await tracker.addBloodPressureReading({
        recordedAt: '2026-02-12T07:00:00.000Z',
        systolic: 118,
        diastolic: 76
      });
      expect(noOptional).toEqual({
        id: 'blood_pressure_0002',
        recordedAt: '2026-02-12T07:00:00.000Z',
        systolic: 118,
        diastolic: 76
      });

      const persisted = await db
        .select({ pulse: healthBloodPressureReadings.pulse })
        .from(healthBloodPressureReadings)
        .where(eq(healthBloodPressureReadings.id, reading.id));
      expect(requireValue(persisted[0]).pulse).toBe(61);

      const listed = await tracker.listBloodPressureReadings();
      requireValue(listed[0]).systolic = 10;

      expect(
        requireValue((await tracker.listBloodPressureReadings())[0]).systolic
      ).toBe(122);
    });
  });

  it('validates blood pressure input', async () => {
    await withHealthDatabase(async ({ db }) => {
      const tracker = createHealthTracker(db, {
        createId: createDeterministicId()
      });

      await expect(
        tracker.addBloodPressureReading({
          recordedAt: '2026-02-12T08:00:00.000Z',
          systolic: 80,
          diastolic: 80
        })
      ).rejects.toThrow('systolic must be greater than diastolic');

      await expect(
        tracker.addBloodPressureReading({
          recordedAt: '2026-02-12T08:00:00.000Z',
          systolic: 120,
          diastolic: 80,
          pulse: 60.5
        })
      ).rejects.toThrow('pulse must be a positive integer');
    });
  });

  it('adds workout entries with exercise selection, reps, and weights', async () => {
    await withHealthDatabase(async ({ db }) => {
      const tracker = createHealthTracker(db, {
        createId: createDeterministicId(),
        now: () => new Date('2026-02-13T09:31:00.000Z')
      });

      const workout = await tracker.addWorkoutEntry({
        performedAt: '2026-02-12T18:00:00.000Z',
        exerciseId: DEFAULT_EXERCISE_IDS.BACK_SQUAT,
        reps: 5,
        weight: 225,
        note: ' top set '
      });

      expect(workout).toEqual({
        id: 'workout_0001',
        performedAt: '2026-02-12T18:00:00.000Z',
        exerciseId: DEFAULT_EXERCISE_IDS.BACK_SQUAT,
        exerciseName: 'Back Squat',
        reps: 5,
        weight: 225,
        weightUnit: 'lb',
        note: 'top set'
      });

      const metricDropDownSelection = await tracker.addWorkoutEntry({
        performedAt: '2026-02-12T19:00:00.000Z',
        exerciseId: DEFAULT_EXERCISE_IDS.BACK_SQUAT,
        reps: 8,
        weight: 0,
        weightUnit: 'kg'
      });
      expect(metricDropDownSelection.weightUnit).toBe('kg');
      expect(metricDropDownSelection.weight).toBe(0);

      const persisted = await db
        .select({
          weightCenti: healthWorkoutEntries.weightCenti,
          weightUnit: healthWorkoutEntries.weightUnit
        })
        .from(healthWorkoutEntries)
        .where(eq(healthWorkoutEntries.id, workout.id));
      expect(requireValue(persisted[0]).weightCenti).toBe(22500);
      expect(requireValue(persisted[0]).weightUnit).toBe('lb');

      const listed = await tracker.listWorkoutEntries();
      requireValue(listed[0]).reps = 1;

      expect(requireValue((await tracker.listWorkoutEntries())[0]).reps).toBe(
        8
      );
    });
  });

  it('validates workout entry input', async () => {
    await withHealthDatabase(async ({ db }) => {
      const tracker = createHealthTracker(db, {
        createId: createDeterministicId()
      });

      await expect(
        tracker.addWorkoutEntry({
          performedAt: '2026-02-12T18:00:00.000Z',
          exerciseId: 'unknown',
          reps: 5,
          weight: 225
        })
      ).rejects.toThrow('Unknown exercise id "unknown"');

      await expect(
        tracker.addWorkoutEntry({
          performedAt: '2026-02-12T18:00:00.000Z',
          exerciseId: DEFAULT_EXERCISE_IDS.BACK_SQUAT,
          reps: 0,
          weight: 225
        })
      ).rejects.toThrow('reps must be a positive integer');

      await expect(
        tracker.addWorkoutEntry({
          performedAt: '2026-02-12T18:00:00.000Z',
          exerciseId: DEFAULT_EXERCISE_IDS.BACK_SQUAT,
          reps: 5,
          weight: -1
        })
      ).rejects.toThrow('weight must be a non-negative number');

      await expect(
        tracker.addWorkoutEntry({
          performedAt: '2026-02-12T18:00:00.000Z',
          exerciseId: '   ',
          reps: 5,
          weight: 0
        })
      ).rejects.toThrow('exerciseId must not be empty');
    });
  });
});
