import type { Migration } from './types';
import { addColumnIfNotExists } from './utils';

/**
 * v005: Add admin flag to users
 *
 * Adds an admin boolean column to the users table.
 */
export const v005: Migration = {
  version: 5,
  description: 'Add admin flag to users',
  up: async (adapter) => {
    await addColumnIfNotExists(
      adapter,
      'users',
      'admin',
      'INTEGER NOT NULL DEFAULT 0'
    );
  }
};
