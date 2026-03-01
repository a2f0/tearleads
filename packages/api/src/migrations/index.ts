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
import { v008 } from './v008.js';
import { v009 } from './v009.js';
import { v010 } from './v010.js';
import { v011 } from './v011.js';
import { v012 } from './v012.js';
import { v013 } from './v013.js';
import { v014 } from './v014.js';
import { v015 } from './v015.js';
import { v016 } from './v016.js';
import { v017 } from './v017.js';
import { v018 } from './v018.js';
import { v019 } from './v019.js';
import { v020 } from './v020.js';
import { v021 } from './v021.js';
import { v022 } from './v022.js';
import { v023 } from './v023.js';
import { v024 } from './v024.js';
import { v025 } from './v025.js';
import { v026 } from './v026.js';
import { v027 } from './v027.js';
import { v028 } from './v028.js';
import { v029 } from './v029.js';

export type { Migration };

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
  v029
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
