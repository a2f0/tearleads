import type { Pool } from 'pg';
import type { Migration } from './types.js';

/**
 * v026: Add PostgreSQL trigger on vfs_acl_entries to emit CRDT ops and sync
 * changes when ACL rows are inserted, updated (revoked/un-revoked), or deleted.
 *
 * Without this trigger, share creation writes to vfs_acl_entries but nothing
 * propagates to vfs_crdt_ops or vfs_sync_changes, leaving ACL changes invisible
 * to the client sync feed.
 */
export const v026: Migration = {
  version: 26,
  description: 'Add vfs_acl_entries sync/CRDT trigger',
  up: async (pool: Pool) => {
    await pool.query('BEGIN');
    try {
      await pool.query(`
        CREATE OR REPLACE FUNCTION "vfs_acl_entries_emit_sync_crdt_trigger"()
        RETURNS TRIGGER
        LANGUAGE plpgsql
        AS $$
        BEGIN
          IF TG_OP = 'DELETE' THEN
            PERFORM "vfs_emit_sync_change"(OLD.item_id, 'acl', OLD.granted_by, NULL);
            INSERT INTO "vfs_crdt_ops" (
              "id",
              "item_id",
              "op_type",
              "principal_type",
              "principal_id",
              "access_level",
              "actor_id",
              "source_table",
              "source_id",
              "occurred_at"
            ) VALUES (
              "vfs_make_event_id"('crdt'),
              OLD.item_id,
              'acl_remove',
              OLD.principal_type,
              OLD.principal_id,
              OLD.access_level,
              OLD.granted_by,
              'vfs_acl_entries',
              OLD.id,
              NOW()
            );
            RETURN OLD;
          END IF;

          IF TG_OP = 'UPDATE' THEN
            -- Revocation: revoked_at transitions NULL -> non-NULL
            IF OLD.revoked_at IS NULL AND NEW.revoked_at IS NOT NULL THEN
              PERFORM "vfs_emit_sync_change"(NEW.item_id, 'acl', NEW.granted_by, NULL);
              INSERT INTO "vfs_crdt_ops" (
                "id",
                "item_id",
                "op_type",
                "principal_type",
                "principal_id",
                "access_level",
                "actor_id",
                "source_table",
                "source_id",
                "occurred_at"
              ) VALUES (
                "vfs_make_event_id"('crdt'),
                NEW.item_id,
                'acl_remove',
                NEW.principal_type,
                NEW.principal_id,
                NEW.access_level,
                NEW.granted_by,
                'vfs_acl_entries',
                NEW.id,
                NOW()
              );
            -- Un-revocation: revoked_at transitions non-NULL -> NULL
            ELSIF OLD.revoked_at IS NOT NULL AND NEW.revoked_at IS NULL THEN
              PERFORM "vfs_emit_sync_change"(NEW.item_id, 'acl', NEW.granted_by, NULL);
              INSERT INTO "vfs_crdt_ops" (
                "id",
                "item_id",
                "op_type",
                "principal_type",
                "principal_id",
                "access_level",
                "actor_id",
                "source_table",
                "source_id",
                "occurred_at"
              ) VALUES (
                "vfs_make_event_id"('crdt'),
                NEW.item_id,
                'acl_add',
                NEW.principal_type,
                NEW.principal_id,
                NEW.access_level,
                NEW.granted_by,
                'vfs_acl_entries',
                NEW.id,
                NOW()
              );
            -- Active ACL row edits (permission/expiry/metadata changes)
            ELSIF OLD.revoked_at IS NULL AND NEW.revoked_at IS NULL AND (
              OLD.access_level IS DISTINCT FROM NEW.access_level
              OR OLD.expires_at IS DISTINCT FROM NEW.expires_at
              OR OLD.granted_by IS DISTINCT FROM NEW.granted_by
              OR OLD.principal_type IS DISTINCT FROM NEW.principal_type
              OR OLD.principal_id IS DISTINCT FROM NEW.principal_id
              OR OLD.item_id IS DISTINCT FROM NEW.item_id
            ) THEN
              PERFORM "vfs_emit_sync_change"(NEW.item_id, 'acl', NEW.granted_by, NULL);
              INSERT INTO "vfs_crdt_ops" (
                "id",
                "item_id",
                "op_type",
                "principal_type",
                "principal_id",
                "access_level",
                "actor_id",
                "source_table",
                "source_id",
                "occurred_at"
              ) VALUES (
                "vfs_make_event_id"('crdt'),
                NEW.item_id,
                'acl_add',
                NEW.principal_type,
                NEW.principal_id,
                NEW.access_level,
                NEW.granted_by,
                'vfs_acl_entries',
                NEW.id,
                NOW()
              );
            END IF;

            RETURN NEW;
          END IF;

          -- INSERT (only active entries, not pre-revoked)
          IF NEW.revoked_at IS NULL THEN
            PERFORM "vfs_emit_sync_change"(NEW.item_id, 'acl', NEW.granted_by, NULL);
            INSERT INTO "vfs_crdt_ops" (
              "id",
              "item_id",
              "op_type",
              "principal_type",
              "principal_id",
              "access_level",
              "actor_id",
              "source_table",
              "source_id",
              "occurred_at"
            ) VALUES (
              "vfs_make_event_id"('crdt'),
              NEW.item_id,
              'acl_add',
              NEW.principal_type,
              NEW.principal_id,
              NEW.access_level,
              NEW.granted_by,
              'vfs_acl_entries',
              NEW.id,
              NOW()
            );
          END IF;

          RETURN NEW;
        END;
        $$;
      `);

      await pool.query(`
        DROP TRIGGER IF EXISTS "vfs_acl_entries_emit_sync_crdt_trigger" ON "vfs_acl_entries";
        CREATE TRIGGER "vfs_acl_entries_emit_sync_crdt_trigger"
        AFTER INSERT OR UPDATE OR DELETE ON "vfs_acl_entries"
        FOR EACH ROW EXECUTE FUNCTION "vfs_acl_entries_emit_sync_crdt_trigger"();
      `);

      await pool.query('COMMIT');
    } catch (error) {
      await pool.query('ROLLBACK');
      throw error;
    }
  }
};
