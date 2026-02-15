import type { Migration } from './types';

/**
 * v021: Re-seed exercises with UUID-based IDs for i18n support
 *
 * This migration deletes old slug-based default exercises (e.g., 'back-squat').
 * New exercises with UUID-based IDs (e.g., 'ex_a1b2c3d4-1001-4000-8000-000000000001')
 * will be automatically seeded when the health tracker is next initialized.
 *
 * Note: This orphans any workout entries that reference the old exercise IDs.
 * Those entries will remain in the database but won't link to an exercise.
 */
export const v021: Migration = {
  version: 21,
  description: 'Re-seed exercises with UUID-based IDs for i18n support',
  up: async (adapter) => {
    // Delete old slug-based default exercises
    // User-created exercises (those with 'exercise_' prefix) are preserved
    await adapter.execute(`
      DELETE FROM health_exercises
      WHERE id NOT LIKE 'exercise_%'
        AND id NOT LIKE 'ex_%'
    `);
  }
};
