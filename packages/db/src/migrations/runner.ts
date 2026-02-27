import type { Pool } from 'pg';
import type { Migration } from './types.js';

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
    return 0;
  }
}

async function recordMigration(pool: Pool, version: number): Promise<void> {
  await pool.query(
    'INSERT INTO schema_migrations (version, applied_at) VALUES ($1, NOW())',
    [version]
  );
}

/**
 * Run all pending migrations from the given array.
 *
 * @param pool - Postgres (or PGlite) connection pool
 * @param migrations - ordered migration definitions
 * @returns applied version numbers and the final schema version
 */
export async function runMigrations(
  pool: Pool,
  migrations: Migration[]
): Promise<{ applied: number[]; currentVersion: number }> {
  const applied: number[] = [];
  const sorted = migrations.slice().sort((a, b) => a.version - b.version);

  const v001 = sorted.find((m) => m.version === 1);
  if (!v001) throw new Error('v001 migration is required');
  await v001.up(pool);

  let currentVersion = await getCurrentVersion(pool);

  if (currentVersion === 0) {
    await recordMigration(pool, 1);
    applied.push(1);
    currentVersion = 1;
  }

  for (const migration of sorted) {
    if (migration.version > currentVersion) {
      await migration.up(pool);
      await recordMigration(pool, migration.version);
      applied.push(migration.version);
    }
  }

  const finalVersion = await getCurrentVersion(pool);
  return { applied, currentVersion: finalVersion };
}
