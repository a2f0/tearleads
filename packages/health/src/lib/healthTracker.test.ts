import {
  healthBloodPressureReadings,
  healthExercises,
  healthWeightReadings,
  healthWorkoutEntries
} from '@tearleads/db/sqlite';
import { withRealDatabase } from '@tearleads/db-test-utils';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { healthTestMigrations } from '../test/healthTestMigrations.js';
import { DEFAULT_EXERCISE_IDS, DEFAULT_EXERCISES } from './defaultExercises.js';
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

describe('createHealthTracker', () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    warnSpy.mockRestore();
  });

  it('seeds default exercises and returns value copies', async () => {
    await withRealDatabase(
      async ({ db }) => {
        const tracker = createHealthTracker(db, {
          createId: createDeterministicId(),
          now: () => new Date('2026-02-13T10:00:00.000Z')
        });

        const firstList = await tracker.listExercises();
        expect(firstList.length).toBe(DEFAULT_EXERCISES.length);
        expect(firstList[0]).toEqual({
          id: DEFAULT_EXERCISE_IDS.BACK_SQUAT,
          name: 'Back Squat'
        });

        const firstExercise = requireValue(firstList[0]);
        firstExercise.name = 'Mutated Locally';

        const secondList = await tracker.listExercises();
        expect(requireValue(secondList[0]).name).toBe('Back Squat');
      },
      { migrations: healthTestMigrations }
    );
  });

  it('lists parent exercises without children', async () => {
    await withRealDatabase(
      async ({ db }) => {
        const tracker = createHealthTracker(db, {
          createId: createDeterministicId(),
          now: () => new Date('2026-02-13T10:00:00.000Z')
        });

        const parents = await tracker.listParentExercises();
        expect(parents).toHaveLength(7);
        expect(parents.map((e) => e.id)).toEqual([
          DEFAULT_EXERCISE_IDS.BACK_SQUAT,
          DEFAULT_EXERCISE_IDS.BENCH_PRESS,
          DEFAULT_EXERCISE_IDS.DEADLIFT,
          DEFAULT_EXERCISE_IDS.OVERHEAD_PRESS,
          DEFAULT_EXERCISE_IDS.BARBELL_ROW,
          DEFAULT_EXERCISE_IDS.PULL_UP,
          DEFAULT_EXERCISE_IDS.PUSH_UP
        ]);
        expect(parents.every((e) => e.parentId === undefined)).toBe(true);
      },
      { migrations: healthTestMigrations }
    );
  });

  it('lists child exercises for a parent', async () => {
    await withRealDatabase(
      async ({ db }) => {
        const tracker = createHealthTracker(db, {
          createId: createDeterministicId(),
          now: () => new Date('2026-02-13T10:00:00.000Z')
        });

        const pullUpChildren = await tracker.listChildExercises(
          DEFAULT_EXERCISE_IDS.PULL_UP
        );
        expect(pullUpChildren.length).toBeGreaterThan(10);
        expect(pullUpChildren[0]).toEqual({
          id: DEFAULT_EXERCISE_IDS.PULL_UP_STRICT,
          name: 'Strict Pull-Up',
          parentId: DEFAULT_EXERCISE_IDS.PULL_UP,
          parentName: 'Pull-Up'
        });
        expect(
          pullUpChildren.every(
            (e) => e.parentId === DEFAULT_EXERCISE_IDS.PULL_UP
          )
        ).toBe(true);

        const noChildren = await tracker.listChildExercises(
          DEFAULT_EXERCISE_IDS.BACK_SQUAT
        );
        expect(noChildren).toHaveLength(0);
      },
      { migrations: healthTestMigrations }
    );
  });

  it('gets exercise hierarchy as a map', async () => {
    await withRealDatabase(
      async ({ db }) => {
        const tracker = createHealthTracker(db, {
          createId: createDeterministicId(),
          now: () => new Date('2026-02-13T10:00:00.000Z')
        });

        const hierarchy = await tracker.getExerciseHierarchy();
        expect(hierarchy.size).toBe(7);
        expect(hierarchy.has(DEFAULT_EXERCISE_IDS.PULL_UP)).toBe(true);
        expect(hierarchy.has(DEFAULT_EXERCISE_IDS.PUSH_UP)).toBe(true);
        expect(hierarchy.has(DEFAULT_EXERCISE_IDS.BACK_SQUAT)).toBe(true);

        const pullUpChildren = requireValue(
          hierarchy.get(DEFAULT_EXERCISE_IDS.PULL_UP)
        );
        expect(pullUpChildren.length).toBeGreaterThan(10);
        expect(pullUpChildren[0]?.name).toBe('Strict Pull-Up');

        const squatChildren = requireValue(
          hierarchy.get(DEFAULT_EXERCISE_IDS.BACK_SQUAT)
        );
        expect(squatChildren).toHaveLength(0);
      },
      { migrations: healthTestMigrations }
    );
  });

  it('adds exercises, trims ids, and prevents duplicates', async () => {
    await withRealDatabase(
      async ({ db }) => {
        const tracker = createHealthTracker(db, {
          createId: createDeterministicId()
        });

        const manualId = await tracker.addExercise({
          id: ' front-squat ',
          name: ' Front Squat '
        });
        expect(manualId).toEqual({ id: 'front-squat', name: 'Front Squat' });

        const slugged = await tracker.addExercise({
          name: 'Romanian Deadlift'
        });
        expect(slugged).toEqual({
          id: 'romanian-deadlift',
          name: 'Romanian Deadlift'
        });

        const generated = await tracker.addExercise({ name: '***' });
        expect(generated).toEqual({ id: 'exercise_0001', name: '***' });

        const persistedRows = await db
          .select({ id: healthExercises.id })
          .from(healthExercises)
          .where(eq(healthExercises.id, 'front-squat'));
        expect(persistedRows).toHaveLength(1);

        await expect(
          tracker.addExercise({ id: 'front-squat', name: 'Duplicate Squat' })
        ).rejects.toThrow('Exercise with id "front-squat" already exists');

        await expect(tracker.addExercise({ name: '   ' })).rejects.toThrow(
          'name must not be empty'
        );
      },
      { migrations: healthTestMigrations }
    );
  });

  it('adds child exercises with parentId', async () => {
    await withRealDatabase(
      async ({ db }) => {
        const tracker = createHealthTracker(db, {
          createId: createDeterministicId()
        });

        const frontSquat = await tracker.addExercise({
          name: 'Front Squat',
          parentId: DEFAULT_EXERCISE_IDS.BACK_SQUAT
        });
        expect(frontSquat).toEqual({
          id: 'front-squat',
          name: 'Front Squat',
          parentId: DEFAULT_EXERCISE_IDS.BACK_SQUAT,
          parentName: 'Back Squat'
        });

        const gobletSquat = await tracker.addExercise({
          id: 'goblet-squat',
          name: 'Goblet Squat',
          parentId: DEFAULT_EXERCISE_IDS.BACK_SQUAT
        });
        expect(gobletSquat).toEqual({
          id: 'goblet-squat',
          name: 'Goblet Squat',
          parentId: DEFAULT_EXERCISE_IDS.BACK_SQUAT,
          parentName: 'Back Squat'
        });

        const squatChildren = await tracker.listChildExercises(
          DEFAULT_EXERCISE_IDS.BACK_SQUAT
        );
        expect(squatChildren).toHaveLength(2);
        expect(squatChildren.map((e) => e.id)).toEqual([
          'front-squat',
          'goblet-squat'
        ]);
      },
      { migrations: healthTestMigrations }
    );
  });

  it('validates parentId references existing exercise', async () => {
    await withRealDatabase(
      async ({ db }) => {
        const tracker = createHealthTracker(db, {
          createId: createDeterministicId()
        });

        await expect(
          tracker.addExercise({
            name: 'Orphan Exercise',
            parentId: 'nonexistent-parent'
          })
        ).rejects.toThrow(
          'Parent exercise with id "nonexistent-parent" not found'
        );

        const blankParent = await tracker.addExercise({
          name: 'Blank Parent',
          parentId: '   '
        });
        expect(blankParent.parentId).toBeUndefined();
      },
      { migrations: healthTestMigrations }
    );
  });

  it('uses default id generation when custom createId is not provided', async () => {
    await withRealDatabase(
      async ({ db }) => {
        const tracker = createHealthTracker(db);

        const reading = await tracker.addWeightReading({
          recordedAt: '2026-02-13T09:15:00.000Z',
          value: 181.2
        });

        expect(reading.id.startsWith('weight_')).toBe(true);
      },
      { migrations: healthTestMigrations }
    );
  });

  it('adds weight readings and persists centi-unit values', async () => {
    await withRealDatabase(
      async ({ db }) => {
        const tracker = createHealthTracker(db, {
          createId: createDeterministicId(),
          now: () => new Date('2026-02-13T09:31:00.000Z')
        });

        const reading = await tracker.addWeightReading({
          recordedAt: new Date('2026-02-13T09:15:00.000Z'),
          value: 187.4,
          note: ' morning check '
        });

        expect(reading).toEqual({
          id: 'weight_0001',
          recordedAt: '2026-02-13T09:15:00.000Z',
          value: 187.4,
          unit: 'lb',
          note: 'morning check'
        });

        const persisted = await db
          .select({
            valueCenti: healthWeightReadings.valueCenti,
            unit: healthWeightReadings.unit,
            note: healthWeightReadings.note
          })
          .from(healthWeightReadings)
          .where(eq(healthWeightReadings.id, reading.id));
        expect(persisted).toHaveLength(1);
        expect(requireValue(persisted[0]).valueCenti).toBe(18740);
        expect(requireValue(persisted[0]).unit).toBe('lb');
        expect(requireValue(persisted[0]).note).toBe('morning check');

        const listed = await tracker.listWeightReadings();
        requireValue(listed[0]).value = 0;

        expect(
          requireValue((await tracker.listWeightReadings())[0]).value
        ).toBe(187.4);
      },
      { migrations: healthTestMigrations }
    );
  });

  it('validates weight reading input and normalizes blank notes', async () => {
    await withRealDatabase(
      async ({ db, adapter }) => {
        const tracker = createHealthTracker(db, {
          createId: createDeterministicId(),
          now: () => new Date('2026-02-13T09:31:00.000Z')
        });

        const reading = await tracker.addWeightReading({
          recordedAt: '2026-02-13T09:15:00.000Z',
          value: 180,
          note: '   '
        });
        expect(reading.note).toBeUndefined();

        await expect(
          tracker.addWeightReading({
            recordedAt: '2026-02-13T09:15:00.000Z',
            value: 0
          })
        ).rejects.toThrow('value must be a positive number');

        await expect(
          tracker.addWeightReading({ recordedAt: 'not-a-date', value: 180 })
        ).rejects.toThrow('recordedAt must be a valid date');

        await expect(
          tracker.addWeightReading({
            recordedAt: new Date('invalid'),
            value: 180
          })
        ).rejects.toThrow('recordedAt must be a valid date');

        await adapter.execute(`
          INSERT INTO health_weight_readings (
            id,
            recorded_at,
            value_centi,
            unit,
            note,
            created_at
          ) VALUES (
            'bad-unit',
            1707964800000,
            12345,
            'stone',
            NULL,
            1707964800000
          )
        `);

        await expect(tracker.listWeightReadings()).rejects.toThrow(
          'unit must be either "lb" or "kg"'
        );
      },
      { migrations: healthTestMigrations }
    );
  });

  it('throws when stored timestamps cannot be parsed to valid dates', async () => {
    await withRealDatabase(
      async ({ db, adapter }) => {
        const tracker = createHealthTracker(db, {
          createId: createDeterministicId(),
          now: () => new Date('2026-02-13T09:31:00.000Z')
        });

        await adapter.execute(`
          INSERT INTO health_weight_readings (
            id,
            recorded_at,
            value_centi,
            unit,
            note,
            created_at
          ) VALUES (
            'bad-timestamp',
            'not-a-timestamp',
            18120,
            'lb',
            NULL,
            1707964800000
          )
        `);

        await expect(tracker.listWeightReadings()).rejects.toThrow(
          'timestamp must be valid'
        );
      },
      { migrations: healthTestMigrations }
    );
  });

  it('adds blood pressure readings and supports optional fields', async () => {
    await withRealDatabase(
      async ({ db }) => {
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
      },
      { migrations: healthTestMigrations }
    );
  });

  it('validates blood pressure input', async () => {
    await withRealDatabase(
      async ({ db }) => {
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
      },
      { migrations: healthTestMigrations }
    );
  });

  it('adds workout entries with exercise selection, reps, and weights', async () => {
    await withRealDatabase(
      async ({ db }) => {
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
      },
      { migrations: healthTestMigrations }
    );
  });

  it('validates workout entry input', async () => {
    await withRealDatabase(
      async ({ db }) => {
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
      },
      { migrations: healthTestMigrations }
    );
  });
});
