import type { Pool } from 'pg';
import type { Migration } from './types.js';

/**
 * Migration v023: Add encrypted envelope columns to vfs_crdt_ops table.
 *
 * Supports encrypted CRDT operations where the actual ACL/link data is stored
 * in an encrypted payload rather than plaintext columns.
 */
export const v023: Migration = {
  version: 23,
  description:
    'Add encrypted envelope columns to vfs_crdt_ops for E2E encrypted CRDT operations',
  up: async (pool: Pool) => {
    await pool.query('BEGIN');
    try {
      // Add encrypted envelope columns in a single statement for atomicity
      // - encrypted_payload: base64-encoded ciphertext
      // - key_epoch: tracks which encryption key version was used
      // - encryption_nonce: base64-encoded nonce
      // - encryption_aad: additional authenticated data hash (base64-encoded)
      // - encryption_signature: integrity verification signature (base64-encoded)
      await pool.query(`
        ALTER TABLE "vfs_crdt_ops"
        ADD COLUMN IF NOT EXISTS "encrypted_payload" TEXT,
        ADD COLUMN IF NOT EXISTS "key_epoch" INTEGER,
        ADD COLUMN IF NOT EXISTS "encryption_nonce" TEXT,
        ADD COLUMN IF NOT EXISTS "encryption_aad" TEXT,
        ADD COLUMN IF NOT EXISTS "encryption_signature" TEXT
      `);

      await pool.query('COMMIT');
    } catch (error) {
      await pool.query('ROLLBACK');
      throw error;
    }
  }
};
