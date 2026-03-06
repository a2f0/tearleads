import type { Migration } from './types';

/**
 * v021: Re-seed exercises with UUID-based IDs for i18n support
 *
 * This migration:
 * 1. Migrates existing workout entries to use new UUID-based exercise IDs
 * 2. Deletes old slug-based default exercises (e.g., 'back-squat')
 *
 * New exercises with UUID-based IDs will be automatically seeded
 * when the health tracker is next initialized.
 */
export const v021: Migration = {
  version: 21,
  description: 'Re-seed exercises with UUID-based IDs for i18n support',
  up: async (adapter) => {
    // First, migrate existing workout entries to use new UUID-based exercise IDs
    await adapter.execute(`
      UPDATE health_workout_entries
      SET exercise_id = CASE exercise_id
        WHEN 'back-squat' THEN 'ex_a1b2c3d4-1001-4000-8000-000000000001'
        WHEN 'bench-press' THEN 'ex_a1b2c3d4-1002-4000-8000-000000000002'
        WHEN 'deadlift' THEN 'ex_a1b2c3d4-1003-4000-8000-000000000003'
        WHEN 'overhead-press' THEN 'ex_a1b2c3d4-1004-4000-8000-000000000004'
        WHEN 'barbell-row' THEN 'ex_a1b2c3d4-1005-4000-8000-000000000005'
        WHEN 'pull-up' THEN 'ex_a1b2c3d4-1006-4000-8000-000000000006'
        WHEN 'pull-up-strict' THEN 'ex_a1b2c3d4-1007-4000-8000-000000000007'
        WHEN 'pull-up-chin-up' THEN 'ex_a1b2c3d4-1008-4000-8000-000000000008'
        WHEN 'pull-up-wide-grip' THEN 'ex_a1b2c3d4-1009-4000-8000-000000000009'
        WHEN 'pull-up-neutral-grip' THEN 'ex_a1b2c3d4-1010-4000-8000-000000000010'
        WHEN 'pull-up-weighted' THEN 'ex_a1b2c3d4-1011-4000-8000-000000000011'
        WHEN 'pull-up-l-sit' THEN 'ex_a1b2c3d4-1012-4000-8000-000000000012'
        WHEN 'pull-up-archer' THEN 'ex_a1b2c3d4-1013-4000-8000-000000000013'
        WHEN 'pull-up-commando' THEN 'ex_a1b2c3d4-1014-4000-8000-000000000014'
        WHEN 'pull-up-kipping' THEN 'ex_a1b2c3d4-1015-4000-8000-000000000015'
        WHEN 'pull-up-towel' THEN 'ex_a1b2c3d4-1016-4000-8000-000000000016'
        WHEN 'pull-up-mixed-grip' THEN 'ex_a1b2c3d4-1017-4000-8000-000000000017'
        WHEN 'pull-up-eccentric' THEN 'ex_a1b2c3d4-1018-4000-8000-000000000018'
        WHEN 'pull-up-around-the-world' THEN 'ex_a1b2c3d4-1019-4000-8000-000000000019'
        WHEN 'pull-up-chest-to-bar' THEN 'ex_a1b2c3d4-1020-4000-8000-000000000020'
        WHEN 'pull-up-one-arm-assisted' THEN 'ex_a1b2c3d4-1021-4000-8000-000000000021'
        ELSE exercise_id
      END
      WHERE exercise_id IN (
        'back-squat', 'bench-press', 'deadlift', 'overhead-press', 'barbell-row', 'pull-up',
        'pull-up-strict', 'pull-up-chin-up', 'pull-up-wide-grip', 'pull-up-neutral-grip',
        'pull-up-weighted', 'pull-up-l-sit', 'pull-up-archer', 'pull-up-commando',
        'pull-up-kipping', 'pull-up-towel', 'pull-up-mixed-grip', 'pull-up-eccentric',
        'pull-up-around-the-world', 'pull-up-chest-to-bar', 'pull-up-one-arm-assisted'
      )
    `);

    // Delete old slug-based default exercises
    // User-created exercises (those with 'exercise_' prefix) are preserved
    await adapter.execute(`
      DELETE FROM health_exercises
      WHERE id NOT LIKE 'exercise_%'
        AND id NOT LIKE 'ex_%'
    `);
  }
};
