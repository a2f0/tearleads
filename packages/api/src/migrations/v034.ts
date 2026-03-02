import type { Pool } from 'pg';
import type { Migration } from './types.js';

/**
 * v034: Add bytea envelope columns for CRDT encrypted payload metadata.
 *
 * Keep existing text columns during staged rollout while new writes migrate
 * to bytea-backed envelope storage.
 */
export const v034: Migration = {
  version: 34,
  description: 'Add bytea CRDT envelope columns',
  up: async (pool: Pool) => {
    await pool.query(`
      ALTER TABLE "vfs_crdt_ops"
      ADD COLUMN IF NOT EXISTS "encrypted_payload_bytes" BYTEA,
      ADD COLUMN IF NOT EXISTS "encryption_nonce_bytes" BYTEA,
      ADD COLUMN IF NOT EXISTS "encryption_aad_bytes" BYTEA,
      ADD COLUMN IF NOT EXISTS "encryption_signature_bytes" BYTEA
    `);

    await pool.query(`
      UPDATE vfs_crdt_ops
      SET encrypted_payload_bytes = decode(encrypted_payload, 'base64')
      WHERE encrypted_payload IS NOT NULL
        AND encrypted_payload_bytes IS NULL
        AND encrypted_payload ~ '^[A-Za-z0-9+/]+={0,2}$'
        AND length(encrypted_payload) % 4 = 0
    `);

    await pool.query(`
      UPDATE vfs_crdt_ops
      SET encryption_nonce_bytes = decode(encryption_nonce, 'base64')
      WHERE encryption_nonce IS NOT NULL
        AND encryption_nonce_bytes IS NULL
        AND encryption_nonce ~ '^[A-Za-z0-9+/]+={0,2}$'
        AND length(encryption_nonce) % 4 = 0
    `);

    await pool.query(`
      UPDATE vfs_crdt_ops
      SET encryption_aad_bytes = decode(encryption_aad, 'base64')
      WHERE encryption_aad IS NOT NULL
        AND encryption_aad_bytes IS NULL
        AND encryption_aad ~ '^[A-Za-z0-9+/]+={0,2}$'
        AND length(encryption_aad) % 4 = 0
    `);

    await pool.query(`
      UPDATE vfs_crdt_ops
      SET encryption_signature_bytes = decode(encryption_signature, 'base64')
      WHERE encryption_signature IS NOT NULL
        AND encryption_signature_bytes IS NULL
        AND encryption_signature ~ '^[A-Za-z0-9+/]+={0,2}$'
        AND length(encryption_signature) % 4 = 0
    `);
  }
};
