import type { Pool } from 'pg';
import type { Migration } from './types.js';

/**
 * v007: Persist verified ACL signer public keys on vfs_crdt_ops rows.
 */
export const v007: Migration = {
  version: 7,
  description: 'Persist ACL signer public keys',
  up: async (pool: Pool) => {
    await pool.query(`
      ALTER TABLE "vfs_crdt_ops"
      ADD COLUMN IF NOT EXISTS "actor_signing_public_key" TEXT;

      UPDATE "vfs_crdt_ops" AS ops
      SET "actor_signing_public_key" = keys.public_signing_key
      FROM "user_keys" AS keys
      WHERE ops."actor_signing_public_key" IS NULL
        AND ops."actor_id" = keys."user_id"
        AND ops."op_type" IN ('acl_add', 'acl_remove')
        AND ops."operation_signature" IS NOT NULL;
    `);
  }
};
