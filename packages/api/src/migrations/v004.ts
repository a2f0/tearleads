import type { Pool } from 'pg';
import type { Migration } from './types.js';

/**
 * v004: MLS binary payloads move from base64 TEXT to BYTEA columns.
 *
 * This migration:
 * 1. Converts MLS key package payload storage to bytea.
 * 2. Converts MLS welcome payload storage to bytea.
 * 3. Converts MLS group state payload storage to bytea.
 */
export const v004: Migration = {
  version: 4,
  description: 'Store MLS payloads as bytea',
  up: async (pool: Pool) => {
    await pool.query(`
      ALTER TABLE "mls_key_packages"
      ALTER COLUMN "key_package_data" TYPE BYTEA
      USING decode(
        regexp_replace("key_package_data", '\\s+', '', 'g'),
        'base64'
      );

      ALTER TABLE "mls_welcome_messages"
      ALTER COLUMN "welcome_data" TYPE BYTEA
      USING decode(
        regexp_replace("welcome_data", '\\s+', '', 'g'),
        'base64'
      );

      ALTER TABLE "mls_group_state"
      ALTER COLUMN "encrypted_state" TYPE BYTEA
      USING decode(
        regexp_replace("encrypted_state", '\\s+', '', 'g'),
        'base64'
      );
    `);
  }
};
