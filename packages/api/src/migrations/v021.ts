import type { Pool } from 'pg';
import type { Migration } from './types.js';

/**
 * v021: Greenfield VFS canonical schema cutover.
 *
 * This one-shot migration is designed for clean-state environments where
 * data backfills are unnecessary. It installs only canonical runtime state
 * needed by current API routes and removes non-canonical VFS tables.
 */
export const v021: Migration = {
  version: 21,
  description: 'One-shot canonical VFS schema for greenfield rollout',
  up: async (pool: Pool) => {
    await pool.query('BEGIN');
    try {
      await pool.query(`
        CREATE TABLE IF NOT EXISTS "vfs_crdt_ops" (
          "id" TEXT PRIMARY KEY,
          "item_id" TEXT NOT NULL REFERENCES "vfs_registry"("id") ON DELETE CASCADE,
          "op_type" TEXT NOT NULL CHECK ("op_type" IN ('acl_add', 'acl_remove', 'link_add', 'link_remove')),
          "principal_type" TEXT CHECK ("principal_type" IN ('user', 'group', 'organization')),
          "principal_id" TEXT,
          "access_level" TEXT CHECK ("access_level" IN ('read', 'write', 'admin')),
          "parent_id" TEXT,
          "child_id" TEXT,
          "actor_id" TEXT REFERENCES "users"("id") ON DELETE SET NULL,
          "source_table" TEXT NOT NULL,
          "source_id" TEXT NOT NULL,
          "occurred_at" TIMESTAMPTZ NOT NULL
        )
      `);

      await pool.query(`
        CREATE INDEX IF NOT EXISTS "vfs_crdt_ops_item_idx"
        ON "vfs_crdt_ops" ("item_id")
      `);
      await pool.query(`
        CREATE INDEX IF NOT EXISTS "vfs_crdt_ops_occurred_idx"
        ON "vfs_crdt_ops" ("occurred_at")
      `);
      await pool.query(`
        CREATE INDEX IF NOT EXISTS "vfs_crdt_ops_source_idx"
        ON "vfs_crdt_ops" ("source_table", "source_id")
      `);
      await pool.query(`
        CREATE INDEX IF NOT EXISTS "vfs_crdt_ops_actor_source_idx"
        ON "vfs_crdt_ops" ("actor_id", "source_table", "source_id")
      `);

      await pool.query(`
        CREATE TABLE IF NOT EXISTS "vfs_sync_client_state" (
          "user_id" TEXT NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
          "client_id" TEXT NOT NULL,
          "last_reconciled_at" TIMESTAMPTZ NOT NULL,
          "last_reconciled_change_id" TEXT NOT NULL,
          "last_reconciled_write_ids" JSONB NOT NULL DEFAULT '{}'::jsonb,
          "updated_at" TIMESTAMPTZ NOT NULL,
          PRIMARY KEY ("user_id", "client_id")
        )
      `);

      await pool.query(`
        CREATE INDEX IF NOT EXISTS "vfs_sync_client_state_user_idx"
        ON "vfs_sync_client_state" ("user_id")
      `);

      await pool.query(`
        CREATE OR REPLACE FUNCTION "vfs_merge_reconciled_write_ids"(
          base JSONB,
          incoming JSONB
        )
        RETURNS JSONB
        LANGUAGE SQL
        IMMUTABLE
        AS $$
          SELECT COALESCE(
            (
              SELECT jsonb_object_agg(
                keys.key,
                GREATEST(
                  CASE
                    WHEN ((COALESCE(base, '{}'::jsonb) ->> keys.key) ~ '^[0-9]+$')
                      THEN (COALESCE(base, '{}'::jsonb) ->> keys.key)::BIGINT
                    ELSE 0
                  END,
                  CASE
                    WHEN ((COALESCE(incoming, '{}'::jsonb) ->> keys.key) ~ '^[0-9]+$')
                      THEN (COALESCE(incoming, '{}'::jsonb) ->> keys.key)::BIGINT
                    ELSE 0
                  END
                )
              )
              FROM (
                SELECT jsonb_object_keys(COALESCE(base, '{}'::jsonb)) AS key
                UNION
                SELECT jsonb_object_keys(COALESCE(incoming, '{}'::jsonb)) AS key
              ) AS keys
            ),
            '{}'::jsonb
          )
        $$;
      `);

      await pool.query(`
        CREATE OR REPLACE FUNCTION "vfs_make_event_id"(prefix TEXT)
        RETURNS TEXT
        LANGUAGE plpgsql
        AS $$
        BEGIN
          RETURN prefix
            || ':'
            || txid_current()::TEXT
            || ':'
            || ((EXTRACT(EPOCH FROM clock_timestamp()) * 1000000)::BIGINT)::TEXT
            || ':'
            || LPAD(((random() * 1000000)::INT)::TEXT, 6, '0');
        END;
        $$;
      `);

      await pool.query(`
        CREATE OR REPLACE FUNCTION "vfs_emit_sync_change"(
          p_item_id TEXT,
          p_change_type TEXT,
          p_changed_by TEXT,
          p_root_id TEXT
        )
        RETURNS VOID
        LANGUAGE plpgsql
        AS $$
        BEGIN
          INSERT INTO "vfs_sync_changes" (
            "id",
            "item_id",
            "change_type",
            "changed_at",
            "changed_by",
            "root_id"
          ) VALUES (
            "vfs_make_event_id"('sync'),
            p_item_id,
            p_change_type,
            NOW(),
            p_changed_by,
            p_root_id
          );
        END;
        $$;
      `);

      await pool.query(`
        CREATE OR REPLACE FUNCTION "vfs_registry_emit_sync_trigger"()
        RETURNS TRIGGER
        LANGUAGE plpgsql
        AS $$
        BEGIN
          IF TG_OP = 'DELETE' THEN
            PERFORM "vfs_emit_sync_change"(OLD.id, 'delete', OLD.owner_id, NULL);
            RETURN OLD;
          END IF;

          PERFORM "vfs_emit_sync_change"(NEW.id, 'upsert', NEW.owner_id, NULL);
          RETURN NEW;
        END;
        $$;
      `);

      await pool.query(`
        CREATE OR REPLACE FUNCTION "vfs_links_emit_sync_crdt_trigger"()
        RETURNS TRIGGER
        LANGUAGE plpgsql
        AS $$
        BEGIN
          IF TG_OP = 'DELETE' THEN
            PERFORM "vfs_emit_sync_change"(OLD.child_id, 'upsert', NULL, OLD.parent_id);
            INSERT INTO "vfs_crdt_ops" (
              "id",
              "item_id",
              "op_type",
              "parent_id",
              "child_id",
              "source_table",
              "source_id",
              "occurred_at"
            ) VALUES (
              "vfs_make_event_id"('crdt'),
              OLD.child_id,
              'link_remove',
              OLD.parent_id,
              OLD.child_id,
              'vfs_links',
              OLD.id,
              NOW()
            );
            RETURN OLD;
          END IF;

          PERFORM "vfs_emit_sync_change"(NEW.child_id, 'upsert', NULL, NEW.parent_id);
          INSERT INTO "vfs_crdt_ops" (
            "id",
            "item_id",
            "op_type",
            "parent_id",
            "child_id",
            "source_table",
            "source_id",
            "occurred_at"
          ) VALUES (
            "vfs_make_event_id"('crdt'),
            NEW.child_id,
            'link_add',
            NEW.parent_id,
            NEW.child_id,
            'vfs_links',
            NEW.id,
            NOW()
          );
          RETURN NEW;
        END;
        $$;
      `);

      await pool.query(`
        DROP TRIGGER IF EXISTS "vfs_registry_emit_sync_trigger" ON "vfs_registry";
        CREATE TRIGGER "vfs_registry_emit_sync_trigger"
        AFTER INSERT OR UPDATE OR DELETE ON "vfs_registry"
        FOR EACH ROW EXECUTE FUNCTION "vfs_registry_emit_sync_trigger"();
      `);

      await pool.query(`
        DROP TRIGGER IF EXISTS "vfs_links_emit_sync_crdt_trigger" ON "vfs_links";
        CREATE TRIGGER "vfs_links_emit_sync_crdt_trigger"
        AFTER INSERT OR DELETE ON "vfs_links"
        FOR EACH ROW EXECUTE FUNCTION "vfs_links_emit_sync_crdt_trigger"();
      `);

      await pool.query('DROP TABLE IF EXISTS "vfs_blob_refs"');
      await pool.query('DROP TABLE IF EXISTS "vfs_blob_staging"');
      await pool.query('DROP TABLE IF EXISTS "vfs_blob_objects"');
      await pool.query('DROP TABLE IF EXISTS "vfs_access"');
      await pool.query('DROP TABLE IF EXISTS "vfs_folders"');
      await pool.query('DROP TABLE IF EXISTS "vfs_shares"');
      await pool.query('DROP TABLE IF EXISTS "org_shares"');
      await pool.query(
        'DROP TABLE IF EXISTS "vfs_share_retirement_checkpoints"'
      );
      await pool.query(
        'DROP TABLE IF EXISTS "vfs_share_retirement_drop_plans"'
      );
      await pool.query(
        'DROP TABLE IF EXISTS "vfs_share_retirement_drop_candidates"'
      );
      await pool.query(
        'DROP TABLE IF EXISTS "vfs_share_retirement_execution_readiness"'
      );
      await pool.query(
        'DROP TABLE IF EXISTS "vfs_share_retirement_drop_authorizations"'
      );
      await pool.query(
        'DROP TABLE IF EXISTS "vfs_share_retirement_drop_execution_candidates"'
      );
      await pool.query(
        'DROP TABLE IF EXISTS "vfs_share_retirement_drop_execution_audit"'
      );

      await pool.query('COMMIT');
    } catch (error) {
      await pool.query('ROLLBACK');
      throw error;
    }
  }
};
