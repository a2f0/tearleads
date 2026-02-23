import { isRecord } from '@tearleads/shared';
import type { DatabaseAdapter } from '../adapters';
import type { Migration } from './types';
import { v001 } from './v001';
import { v002 } from './v002';
import { v003 } from './v003';
import { v004 } from './v004';
import { v005 } from './v005';
import { v006 } from './v006';
import { v007 } from './v007';
import { v008 } from './v008';
import { v009 } from './v009';
import { v010 } from './v010';
import { v011 } from './v011';
import { v012 } from './v012';
import { v013 } from './v013';
import { v014 } from './v014';
import { v015 } from './v015';
import { v016 } from './v016';
import { v017 } from './v017';
import { v018 } from './v018';
import { v019 } from './v019';
import { v020 } from './v020';
import { v021 } from './v021';
import { v022 } from './v022';
import { v023 } from './v023';
import { v024 } from './v024';
import { v025 } from './v025';

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
  v025
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
  await v001Migration.up(adapter);

  // Check current version
  let currentVersion = await getCurrentVersion(adapter);

  // If this is a fresh database, record v001 and update our local version
  if (currentVersion === 0) {
    await recordMigration(adapter, 1);
    applied.push(1);
    currentVersion = 1;
  }

  // Run any migrations newer than current version
  for (const migration of sortedMigrations) {
    if (migration.version > currentVersion) {
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
