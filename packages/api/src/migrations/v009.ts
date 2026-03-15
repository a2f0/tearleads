import type { Pool } from 'pg';
import type { Migration } from './types.js';

/**
 * v009: Widen manifest byte-size columns from INTEGER to BIGINT.
 *
 * PostgreSQL INTEGER is 32-bit (max ~2 GB). BIGINT supports files up to 8 EB,
 * removing the size ceiling for large blob uploads.
 */
export const v009: Migration = {
  version: 9,
  description: 'Widen manifest byte columns to bigint',
  up: async (pool: Pool) => {
    await pool.query(`
      ALTER TABLE "vfs_blob_manifests"
        ALTER COLUMN "total_plaintext_bytes" SET DATA TYPE BIGINT,
        ALTER COLUMN "total_ciphertext_bytes" SET DATA TYPE BIGINT;
    `);
  }
};
