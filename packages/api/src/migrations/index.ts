import {
  getCurrentVersion as getCurrentVersionBase,
  type Migration,
  runMigrations as runMigrationsBase
} from '@tearleads/db/migrations';
import type { Pool } from 'pg';
import { v001 } from './v001.js';
import { v002 } from './v002.js';
import { v003 } from './v003.js';

export type { Migration };

/**
 * All migrations in order. Add new migrations to this array.
 * Migrations must have sequential version numbers starting from 1.
 */
export const migrations: Migration[] = [
  v001,
  v002,
  v003
];

export const getCurrentVersion = getCurrentVersionBase;

/**
 * Run all pending migrations.
 */
export async function runMigrations(pool: Pool): Promise<{
  applied: number[];
  currentVersion: number;
}> {
  return runMigrationsBase(pool, migrations);
}
