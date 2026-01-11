import type { DatabaseAdapter } from '../adapters';

/**
 * A database migration function.
 * Returns true if the migration was applied, false if skipped.
 */
export type MigrationFn = (adapter: DatabaseAdapter) => Promise<void>;

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
