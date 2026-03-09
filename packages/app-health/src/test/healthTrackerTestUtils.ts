import type { TestDatabaseContext } from '@tearleads/db-test-utils';
import { withRealDatabase } from '@tearleads/db-test-utils';
import { healthTestMigrations } from './healthTestMigrations.js';

export const createDeterministicId = (): ((prefix: string) => string) => {
  let sequence = 1;
  return (prefix: string): string => {
    const id = `${prefix}_${String(sequence).padStart(4, '0')}`;
    sequence += 1;
    return id;
  };
};

export const requireValue = <T>(value: T | undefined): T => {
  if (value === undefined) {
    throw new Error('Expected value to be defined in test');
  }

  return value;
};

export const withHealthDatabase = async <T>(
  callback: (context: TestDatabaseContext) => Promise<T>
): Promise<T> =>
  withRealDatabase(callback, {
    migrations: healthTestMigrations
  });
