import type { Pool } from 'pg';
import type { Migration } from './types.js';

/**
 * v022: Add blob isolation tables and CRDT op log with sync triggers
 *
 * Creates:
 * - vfs_blob_objects: immutable blob metadata
 * - vfs_blob_staging: staged->attached blob lifecycle
 * - vfs_blob_refs: attached blob references to VFS items
 * - vfs_crdt_ops: CRDT-style ACL/link operation log
 *
 * Also installs DB triggers so VFS mutations append sync + CRDT entries
 * transactionally without relying on API write-path discipline.
 */
export const v022: Migration = {
  version: 22,
  description:
    'Add blob staging tables and CRDT/sync triggers for VFS mutations',
  up: async (pool: Pool) => {
    await pool.query('BEGIN');
    try {
      await pool.query(`
        CREATE TABLE IF NOT EXISTS "vfs_blob_objects" (
          "id" TEXT PRIMARY KEY,
          "sha256" TEXT NOT NULL,
          "size_bytes" INTEGER NOT NULL,
          "storage_key" TEXT NOT NULL UNIQUE,
          "created_by" TEXT NOT NULL REFERENCES "users"("id") ON DELETE RESTRICT,
          "created_at" TIMESTAMPTZ NOT NULL
        )
      `);

      await pool.query(`
        CREATE INDEX IF NOT EXISTS "vfs_blob_objects_sha_idx"
        ON "vfs_blob_objects" ("sha256")
      `);

      await pool.query(`
        CREATE TABLE IF NOT EXISTS "vfs_blob_staging" (
          "id" TEXT PRIMARY KEY,
          "blob_id" TEXT NOT NULL REFERENCES "vfs_blob_objects"("id") ON DELETE CASCADE,
          "staged_by" TEXT NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
          "status" TEXT NOT NULL CHECK ("status" IN ('staged', 'attached', 'abandoned')),
          "staged_at" TIMESTAMPTZ NOT NULL,
          "attached_at" TIMESTAMPTZ,
          "expires_at" TIMESTAMPTZ NOT NULL,
          "attached_item_id" TEXT REFERENCES "vfs_registry"("id") ON DELETE SET NULL
        )
      `);

      await pool.query(`
        CREATE INDEX IF NOT EXISTS "vfs_blob_staging_status_idx"
        ON "vfs_blob_staging" ("status")
      `);
      await pool.query(`
        CREATE INDEX IF NOT EXISTS "vfs_blob_staging_expires_idx"
        ON "vfs_blob_staging" ("expires_at")
      `);
      await pool.query(`
        CREATE INDEX IF NOT EXISTS "vfs_blob_staging_staged_by_idx"
        ON "vfs_blob_staging" ("staged_by")
      `);

      await pool.query(`
        CREATE TABLE IF NOT EXISTS "vfs_blob_refs" (
          "id" TEXT PRIMARY KEY,
          "blob_id" TEXT NOT NULL REFERENCES "vfs_blob_objects"("id") ON DELETE CASCADE,
          "item_id" TEXT NOT NULL REFERENCES "vfs_registry"("id") ON DELETE CASCADE,
          "relation_kind" TEXT NOT NULL CHECK ("relation_kind" IN ('file', 'emailAttachment', 'photo', 'other')),
          "attached_by" TEXT NOT NULL REFERENCES "users"("id") ON DELETE RESTRICT,
          "attached_at" TIMESTAMPTZ NOT NULL,
          UNIQUE ("blob_id", "item_id", "relation_kind")
        )
      `);

      await pool.query(`
        CREATE INDEX IF NOT EXISTS "vfs_blob_refs_item_idx"
        ON "vfs_blob_refs" ("item_id")
      `);
      await pool.query(`
        CREATE INDEX IF NOT EXISTS "vfs_blob_refs_blob_idx"
        ON "vfs_blob_refs" ("blob_id")
      `);

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
        CREATE OR REPLACE FUNCTION "vfs_shares_emit_sync_crdt_trigger"()
        RETURNS TRIGGER
        LANGUAGE plpgsql
        AS $$
        DECLARE
          v_item_id TEXT;
          v_principal_type TEXT;
          v_principal_id TEXT;
          v_permission_level TEXT;
          v_actor_id TEXT;
          v_source_id TEXT;
          v_op_type TEXT;
        BEGIN
          IF TG_OP = 'DELETE' THEN
            v_item_id := OLD.item_id;
            v_principal_type := OLD.share_type;
            v_principal_id := OLD.target_id;
            v_permission_level := OLD.permission_level;
            v_actor_id := OLD.created_by;
            v_source_id := OLD.id;
            v_op_type := 'acl_remove';
          ELSE
            v_item_id := NEW.item_id;
            v_principal_type := NEW.share_type;
            v_principal_id := NEW.target_id;
            v_permission_level := NEW.permission_level;
            v_actor_id := NEW.created_by;
            v_source_id := NEW.id;
            v_op_type := 'acl_add';
          END IF;

          PERFORM "vfs_emit_sync_change"(v_item_id, 'acl', v_actor_id, v_item_id);

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
            v_item_id,
            v_op_type,
            v_principal_type,
            v_principal_id,
            CASE v_permission_level
              WHEN 'edit' THEN 'write'
              ELSE 'read'
            END,
            v_actor_id,
            'vfs_shares',
            v_source_id,
            NOW()
          );

          IF TG_OP = 'DELETE' THEN
            RETURN OLD;
          END IF;
          RETURN NEW;
        END;
        $$;
      `);

      await pool.query(`
        CREATE OR REPLACE FUNCTION "org_shares_emit_sync_crdt_trigger"()
        RETURNS TRIGGER
        LANGUAGE plpgsql
        AS $$
        DECLARE
          v_item_id TEXT;
          v_principal_id TEXT;
          v_permission_level TEXT;
          v_actor_id TEXT;
          v_source_id TEXT;
          v_op_type TEXT;
        BEGIN
          IF TG_OP = 'DELETE' THEN
            v_item_id := OLD.item_id;
            v_principal_id := OLD.target_org_id;
            v_permission_level := OLD.permission_level;
            v_actor_id := OLD.created_by;
            v_source_id := OLD.id;
            v_op_type := 'acl_remove';
          ELSE
            v_item_id := NEW.item_id;
            v_principal_id := NEW.target_org_id;
            v_permission_level := NEW.permission_level;
            v_actor_id := NEW.created_by;
            v_source_id := NEW.id;
            v_op_type := 'acl_add';
          END IF;

          PERFORM "vfs_emit_sync_change"(v_item_id, 'acl', v_actor_id, v_item_id);

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
            v_item_id,
            v_op_type,
            'organization',
            v_principal_id,
            CASE v_permission_level
              WHEN 'edit' THEN 'write'
              ELSE 'read'
            END,
            v_actor_id,
            'org_shares',
            v_source_id,
            NOW()
          );

          IF TG_OP = 'DELETE' THEN
            RETURN OLD;
          END IF;
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
        DROP TRIGGER IF EXISTS "vfs_shares_emit_sync_crdt_trigger" ON "vfs_shares";
        CREATE TRIGGER "vfs_shares_emit_sync_crdt_trigger"
        AFTER INSERT OR UPDATE OR DELETE ON "vfs_shares"
        FOR EACH ROW EXECUTE FUNCTION "vfs_shares_emit_sync_crdt_trigger"();
      `);

      await pool.query(`
        DROP TRIGGER IF EXISTS "org_shares_emit_sync_crdt_trigger" ON "org_shares";
        CREATE TRIGGER "org_shares_emit_sync_crdt_trigger"
        AFTER INSERT OR UPDATE OR DELETE ON "org_shares"
        FOR EACH ROW EXECUTE FUNCTION "org_shares_emit_sync_crdt_trigger"();
      `);

      await pool.query(`
        DROP TRIGGER IF EXISTS "vfs_links_emit_sync_crdt_trigger" ON "vfs_links";
        CREATE TRIGGER "vfs_links_emit_sync_crdt_trigger"
        AFTER INSERT OR DELETE ON "vfs_links"
        FOR EACH ROW EXECUTE FUNCTION "vfs_links_emit_sync_crdt_trigger"();
      `);

      await pool.query('COMMIT');
    } catch (error) {
      await pool.query('ROLLBACK');
      throw error;
    }
  }
};
