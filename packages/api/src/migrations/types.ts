import type { Pool } from 'pg';

/**
 * A database migration function for PostgreSQL.
 */
export type MigrationFn = (pool: Pool) => Promise<void>;

/**
 * A versioned migration with metadata.
 */
export interface Migration {
  /** Unique version number (must be sequential starting from 1) */
  version: number;
  /** Human-readable description of what this migration does */
  description: string;
  /** The migration function to execute */
  up: MigrationFn;
}
