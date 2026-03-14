import {
  getCurrentVersion as getCurrentVersionBase,
  type Migration,
  runMigrations as runMigrationsBase
} from '@tearleads/db/migrations';
import type { Pool } from 'pg';
import { v001 } from './v001.js';
import { v002 } from './v002.js';
import { v003 } from './v003.js';
import { v004 } from './v004.js';
import { v005 } from './v005.js';
import { v006 } from './v006.js';
import { v007 } from './v007.js';

/**
 * Migration list.
 *
 * We consolidated 41 migrations into focused staged migrations for greenfield performance.
 */
export const migrations: Migration[] = [v001, v002, v003, v004, v005, v006, v007];

/**
 * Get the current migration version.
 */
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
