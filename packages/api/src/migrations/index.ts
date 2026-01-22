import type { Pool } from 'pg';
import type { Migration } from './types.js';
import { v001 } from './v001.js';

export type { Migration, MigrationFn } from './types.js';

/**
 * All migrations in order. Add new migrations to this array.
 * Migrations must have sequential version numbers starting from 1.
 */
export const migrations: Migration[] = [v001];

/**
 * Get the current schema version from the database.
 * Returns 0 if no migrations have been applied.
 */
export async function getCurrentVersion(pool: Pool): Promise<number> {
  try {
    const result = await pool.query<{ version: number }>(
      'SELECT MAX(version) as version FROM schema_migrations'
    );
    const row = result.rows[0];
    if (result.rows.length > 0 && row && row.version !== null) {
      return row.version;
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
async function recordMigration(pool: Pool, version: number): Promise<void> {
  await pool.query(
    'INSERT INTO schema_migrations (version, applied_at) VALUES ($1, NOW())',
    [version]
  );
}

/**
 * Run all pending migrations.
 * Checks which migrations have been applied and only runs those that haven't.
 *
 * @returns Object with applied migration versions and current version
 */
export async function runMigrations(pool: Pool): Promise<{
  applied: number[];
  currentVersion: number;
}> {
  const applied: number[] = [];

  // Ensure migrations are sorted by version
  const sortedMigrations = migrations
    .slice()
    .sort((a, b) => a.version - b.version);

  // Always run v001 first to ensure schema_migrations table exists
  // v001 uses CREATE TABLE IF NOT EXISTS, so it's idempotent
  const v001Migration = sortedMigrations.find((m) => m.version === 1);
  if (!v001Migration) {
    throw new Error('v001 migration is required');
  }
  await v001Migration.up(pool);

  // Check current version
  let currentVersion = await getCurrentVersion(pool);

  // If this is a fresh database, record v001 and update our local version
  if (currentVersion === 0) {
    await recordMigration(pool, 1);
    applied.push(1);
    currentVersion = 1;
  }

  // Run any migrations newer than current version
  for (const migration of sortedMigrations) {
    if (migration.version > currentVersion) {
      await migration.up(pool);
      await recordMigration(pool, migration.version);
      applied.push(migration.version);
    }
  }

  const finalVersion = await getCurrentVersion(pool);

  return {
    applied,
    currentVersion: finalVersion
  };
}
