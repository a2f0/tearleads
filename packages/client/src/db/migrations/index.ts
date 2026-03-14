import type { Migration } from '@tearleads/db/sqlite-migrations';
import {
  v001,
  v002,
  v003,
  v004,
  v005,
  v006,
  v007,
  v008,
  v009,
  v010,
  v011,
  v012,
  v013,
  v014,
  v015,
  v016,
  v017,
  v018,
  v019,
  v020,
  v021,
  v022,
  v023,
  v024,
  v025,
  v026,
  v027,
  v028,
  v029,
  v030,
  v031
} from '@tearleads/db/sqlite-migrations';
import { isRecord } from '@tearleads/shared';
import { logStore } from '@/stores/logStore';
import type { DatabaseAdapter } from '../adapters';

/**
 * All migrations in order. Add new migrations to this array.
 * Migrations must have sequential version numbers starting from 1.
 */
export const migrations: Migration[] = [
  v001,
  v002,
  v003,
  v004,
  v005,
  v006,
  v007,
  v008,
  v009,
  v010,
  v011,
  v012,
  v013,
  v014,
  v015,
  v016,
  v017,
  v018,
  v019,
  v020,
  v021,
  v022,
  v023,
  v024,
  v025,
  v026,
  v027,
  v028,
  v029,
  v030,
  v031
];

/**
 * Get the current schema version from the database.
 * Returns 0 if no migrations have been applied.
 */
async function getCurrentVersion(adapter: DatabaseAdapter): Promise<number> {
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
    'INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)',
    [version, Date.now()]
  );
}

/**
 * Callback invoked before each migration is applied.
 * @param index - 0-based index of the migration being applied
 * @param total - total number of pending migrations
 * @param version - version number of the migration
 * @param description - human-readable description
 */
type MigrationProgressCallback = (
  index: number,
  total: number,
  version: number,
  description: string
) => void;

/**
 * Run all pending migrations.
 * Checks which migrations have been applied and only runs those that haven't.
 *
 * @param onProgress - optional callback invoked before each pending migration
 * @returns Object with applied migration versions and any errors
 */
export async function runMigrations(
  adapter: DatabaseAdapter,
  onProgress?: MigrationProgressCallback
): Promise<{
  applied: number[];
  currentVersion: number;
}> {
  const runStart = performance.now();
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

  // Wrap all migrations in a single transaction to avoid per-statement
  // OPFS fsync. Without this, each execute() runs in autocommit mode,
  // triggering an fsync to the Origin Private File System on every call.
  // With ~87 execute() calls across 29 migrations, this caused 30-60s
  // of blocking on a fresh database. A single transaction reduces fsyncs
  // from ~87 to 1.
  await adapter.beginTransaction();
  try {
    const v001Start = performance.now();
    await v001Migration.up(adapter);
    logStore.debug(
      `[migrations] v001 (schema bootstrap): ${(performance.now() - v001Start).toFixed(1)}ms`
    );

    // Check current version
    let currentVersion = await getCurrentVersion(adapter);

    // If this is a fresh database, record v001 and update our local version
    if (currentVersion === 0) {
      await recordMigration(adapter, 1);
      applied.push(1);
      currentVersion = 1;
    }

    // Determine pending migrations
    const pending = sortedMigrations.filter((m) => m.version > currentVersion);

    // Run any migrations newer than current version
    for (const [i, migration] of pending.entries()) {
      onProgress?.(i, pending.length, migration.version, migration.description);

      const migStart = performance.now();
      await migration.up(adapter);
      await recordMigration(adapter, migration.version);
      applied.push(migration.version);
      logStore.debug(
        `[migrations] v${String(migration.version).padStart(3, '0')} (${migration.description}): ${(performance.now() - migStart).toFixed(1)}ms`
      );
    }

    await adapter.commitTransaction();
  } catch (error) {
    await adapter.rollbackTransaction();
    throw error;
  }

  const finalVersion = await getCurrentVersion(adapter);

  logStore.debug(
    `[migrations] total: ${(performance.now() - runStart).toFixed(1)}ms, applied ${applied.length}/${sortedMigrations.length}`
  );

  return {
    applied,
    currentVersion: finalVersion
  };
}
