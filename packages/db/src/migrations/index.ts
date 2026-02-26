/**
 * Database migration runner — for server-side use only.
 *
 * Exported via '@tearleads/db/migrations' so packages outside
 * @tearleads/api can run migrations without importing the API.
 */

export { getCurrentVersion, runMigrations } from './runner.js';
export type { Migration, MigrationFn } from './types.js';
