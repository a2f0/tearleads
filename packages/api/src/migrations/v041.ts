import type { Pool } from 'pg';
import type { Migration } from './types.js';

/**
 * v041: Finalize UUID migration and update event ID generation.
 *
 * This migration:
 * 1. Redefines vfs_make_event_id to return pure UUIDs.
 * 2. Migrates remaining text IDs (with prefixes) to pure UUIDs.
 */
export const v041: Migration = {
  version: 41,
  description: 'Finalize UUID migration',
  up: async (pool: Pool) => {
    // 1. Redefine event ID generator to return UUID
    await pool.query(`
      CREATE OR REPLACE FUNCTION "vfs_make_event_id"(prefix TEXT)
      RETURNS UUID
      LANGUAGE plpgsql
      AS $$
      BEGIN
        -- In greenfield, we just use random UUIDs for all events.
        -- The prefix is ignored but kept for signature compatibility.
        RETURN gen_random_uuid();
      END;
      $$;
    `);

    // 2. Migrate prefixed IDs to UUIDs in vfs_crdt_ops and vfs_acl_entries
    // Since we are greenfielding, we can afford to convert these.
    // Prefixed IDs like 'crdt:...' or 'share:...' need to be handled.
    // If they aren't valid UUIDs, we'll replace them with new random UUIDs
    // to satisfy the type constraint, which is acceptable in a DB-wipe scenario.

    await pool.query(`
      -- Clean up vfs_crdt_ops IDs
      -- First, remove prefixes and try to cast. If it fails, use a new UUID.
      ALTER TABLE "vfs_crdt_ops" ALTER COLUMN "id" TYPE UUID USING (
        CASE 
          WHEN id LIKE 'crdt:%' THEN 
            CASE 
              WHEN length(split_part(id, ':', 2)) = 36 THEN split_part(id, ':', 2)::uuid
              ELSE gen_random_uuid()
            END
          WHEN length(id) = 36 THEN id::uuid
          ELSE gen_random_uuid()
        END
      );

      -- Clean up vfs_acl_entries IDs
      ALTER TABLE "vfs_acl_entries" ALTER COLUMN "id" TYPE UUID USING (
        CASE 
          WHEN id LIKE 'share:%' THEN 
            CASE 
              WHEN length(split_part(id, ':', 2)) = 36 THEN split_part(id, ':', 2)::uuid
              ELSE gen_random_uuid()
            END
          WHEN id LIKE 'org-share:%' THEN gen_random_uuid() -- Multiple colons, just refresh
          WHEN length(id) = 36 THEN id::uuid
          ELSE gen_random_uuid()
        END
      );
    `);

    // 3. Migrate other entity IDs if missed
    await pool.query(`
      ALTER TABLE "notes" ALTER COLUMN "id" TYPE UUID USING id::uuid;
      ALTER TABLE "files" ALTER COLUMN "id" TYPE UUID USING id::uuid;
      ALTER TABLE "contacts" ALTER COLUMN "id" TYPE UUID USING id::uuid;
      ALTER TABLE "contact_phones" ALTER COLUMN "id" TYPE UUID USING id::uuid;
      ALTER TABLE "contact_phones" ALTER COLUMN "contact_id" TYPE UUID USING contact_id::uuid;
      ALTER TABLE "contact_emails" ALTER COLUMN "id" TYPE UUID USING id::uuid;
      ALTER TABLE "contact_emails" ALTER COLUMN "contact_id" TYPE UUID USING contact_id::uuid;
    `);
  }
};
