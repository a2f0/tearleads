import type { Pool } from 'pg';

export type MigrationFn = (pool: Pool) => Promise<void>;

export interface Migration {
  version: number;
  description: string;
  up: MigrationFn;
}
