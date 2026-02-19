import { healthExercises } from '@tearleads/db/sqlite';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createDeterministicId,
  requireValue,
  withHealthDatabase
} from '../test/healthTrackerTestUtils.js';

import { DEFAULT_EXERCISE_IDS, DEFAULT_EXERCISES } from './defaultExercises.js';
import { createHealthTracker } from './healthTracker.js';

describe('createHealthTracker exercises', () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    warnSpy.mockRestore();
  });

  it('seeds default exercises and returns value copies', async () => {
    await withHealthDatabase(async ({ db }) => {
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
    });
  });

  it('lists parent exercises without children', async () => {
    await withHealthDatabase(async ({ db }) => {
      const tracker = createHealthTracker(db, {
        createId: createDeterministicId(),
        now: () => new Date('2026-02-13T10:00:00.000Z')
      });

      const parents = await tracker.listParentExercises();
      expect(parents).toHaveLength(7);
      expect(parents.map((exercise) => exercise.id)).toEqual([
        DEFAULT_EXERCISE_IDS.BACK_SQUAT,
        DEFAULT_EXERCISE_IDS.BENCH_PRESS,
        DEFAULT_EXERCISE_IDS.DEADLIFT,
        DEFAULT_EXERCISE_IDS.OVERHEAD_PRESS,
        DEFAULT_EXERCISE_IDS.BARBELL_ROW,
        DEFAULT_EXERCISE_IDS.PULL_UP,
        DEFAULT_EXERCISE_IDS.PUSH_UP
      ]);
      expect(parents.every((exercise) => exercise.parentId === undefined)).toBe(
        true
      );
    });
  });

  it('lists child exercises for a parent', async () => {
    await withHealthDatabase(async ({ db }) => {
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
          (exercise) => exercise.parentId === DEFAULT_EXERCISE_IDS.PULL_UP
        )
      ).toBe(true);

      const noChildren = await tracker.listChildExercises(
        DEFAULT_EXERCISE_IDS.BACK_SQUAT
      );
      expect(noChildren).toHaveLength(0);
    });
  });

  it('gets exercise hierarchy as a map', async () => {
    await withHealthDatabase(async ({ db }) => {
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
    });
  });

  it('adds exercises, trims ids, and prevents duplicates', async () => {
    await withHealthDatabase(async ({ db }) => {
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
    });
  });

  it('adds child exercises with parentId', async () => {
    await withHealthDatabase(async ({ db }) => {
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
      expect(squatChildren.map((exercise) => exercise.id)).toEqual([
        'front-squat',
        'goblet-squat'
      ]);
    });
  });

  it('validates parentId references existing exercise', async () => {
    await withHealthDatabase(async ({ db }) => {
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
    });
  });
});
