import { isRecord } from '@rapid/shared';
import type { DatabaseAdapter } from '../adapters';
import type { Migration } from './types';
import { v001 } from './v001';
import { v002 } from './v002';

export type { Migration, MigrationFn } from './types';
export { addColumnIfNotExists } from './utils';

/**
 * All migrations in order. Add new migrations to this array.
 * Migrations must have sequential version numbers starting from 1.
 */
export const migrations: Migration[] = [v001, v002];

/**
 * Get the current schema version from the database.
 * Returns 0 if no migrations have been applied.
 */
export async function getCurrentVersion(
  adapter: DatabaseAdapter
): Promise<number> {
  try {
    const result = await adapter.execute(
      'SELECT MAX(version) as version FROM schema_migrations'
    );
    if (result?.rows?.length && isRecord(result.rows[0])) {
      const version = result.rows[0]['version'];
      return typeof version === 'number' ? version : 0;
    }
    return 0;
  } catch {
    // Table doesn't exist yet, return 0
    return 0;
  }
}

/**
 * Record a migration as applied in the database.
 */
async function recordMigration(
  adapter: DatabaseAdapter,
  version: number
): Promise<void> {
  await adapter.execute(
    `INSERT INTO schema_migrations (version, applied_at) VALUES (${version}, ${Date.now()})`
  );
}

/**
 * Run all pending migrations.
 * Checks which migrations have been applied and only runs those that haven't.
 *
 * @returns Object with applied migration versions and any errors
 */
export async function runMigrations(adapter: DatabaseAdapter): Promise<{
  applied: number[];
  currentVersion: number;
}> {
  const applied: number[] = [];

  // Always run v001 first to ensure schema_migrations table exists
  // v001 uses CREATE TABLE IF NOT EXISTS, so it's idempotent
  const v001Migration = migrations[0];
  if (!v001Migration) {
    throw new Error('v001 migration is required');
  }
  await v001Migration.up(adapter);

  // Check current version
  const currentVersion = await getCurrentVersion(adapter);

  // If this is a fresh database, record v001
  if (currentVersion === 0) {
    await recordMigration(adapter, 1);
    applied.push(1);
  }

  // Run any migrations newer than current version
  for (const migration of migrations) {
    if (migration.version > Math.max(currentVersion, 1)) {
      await migration.up(adapter);
      await recordMigration(adapter, migration.version);
      applied.push(migration.version);
    }
  }

  const finalVersion = await getCurrentVersion(adapter);

  return {
    applied,
    currentVersion: finalVersion
  };
}
