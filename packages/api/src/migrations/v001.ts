import type { Pool } from 'pg';
import type { Migration } from './types.js';

/**
 * v001: Core Initial Schema (UUID-first)
 *
 * This migration creates the foundational identity and VFS tables with:
 * 1. UUID primary and foreign keys.
 * 2. Optimized VFS registry, sync, and CRDT tables.
 */
export const v001: Migration = {
  version: 1,
  description: 'Core Initial Schema',
  up: async (pool: Pool) => {
    // 1. Setup UUID generation (with fallback for pglite/test environments)
    await pool.query(`
      CREATE OR REPLACE FUNCTION "gen_random_uuid"()
      RETURNS UUID AS $$
      DECLARE
        v_uuid TEXT;
      BEGIN
        -- Try to use pgcrypto if available
        BEGIN
          RETURN public.gen_random_uuid();
        EXCEPTION WHEN undefined_function THEN
          -- Fallback RFC 4122 compliant UUID v4 implementation
          v_uuid := lower(
            lpad(to_hex(floor(random() * 4294967296)::bigint), 8, '0') || '-' ||
            lpad(to_hex(floor(random() * 65536)::int), 4, '0') || '-' ||
            '4' || lpad(to_hex(floor(random() * 4096)::int), 3, '0') || '-' ||
            to_hex((floor(random() * 4)::int + 8)) || lpad(to_hex(floor(random() * 4096)::int), 3, '0') || '-' ||
            lpad(to_hex(floor(random() * 4294967296)::bigint), 8, '0') ||
            lpad(to_hex(floor(random() * 65536)::int), 4, '0')
          );
          RETURN v_uuid::UUID;
        END;
      END;
      $$ LANGUAGE plpgsql;
    `);

    // Schema migrations table (must exist for the runner)
    await pool.query(`
      CREATE TABLE IF NOT EXISTS "schema_migrations" (
        "version" INTEGER PRIMARY KEY,
        "applied_at" TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    // 2. Identity & Access
    await pool.query(`
      CREATE TABLE "users" (
        "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        "email" TEXT NOT NULL UNIQUE,
        "email_confirmed" BOOLEAN NOT NULL DEFAULT FALSE,
        "admin" BOOLEAN NOT NULL DEFAULT FALSE,
        "disabled" BOOLEAN NOT NULL DEFAULT FALSE,
        "disabled_at" TIMESTAMPTZ,
        "disabled_by" UUID REFERENCES "users"("id"),
        "marked_for_deletion_at" TIMESTAMPTZ,
        "marked_for_deletion_by" UUID REFERENCES "users"("id"),
        "last_active_at" TIMESTAMPTZ,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        "updated_at" TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX "users_email_idx" ON "users" ("email");

      CREATE TABLE "user_credentials" (
        "user_id" UUID PRIMARY KEY REFERENCES "users"("id") ON DELETE CASCADE,
        "password_hash" TEXT NOT NULL,
        "password_salt" TEXT NOT NULL,
        "created_at" TIMESTAMPTZ NOT NULL,
        "updated_at" TIMESTAMPTZ NOT NULL
      );

      CREATE TABLE "user_keys" (
        "user_id" UUID PRIMARY KEY REFERENCES "users"("id") ON DELETE CASCADE,
        "public_encryption_key" TEXT NOT NULL,
        "public_signing_key" TEXT NOT NULL,
        "encrypted_private_keys" TEXT NOT NULL,
        "argon2_salt" TEXT NOT NULL,
        "recovery_key_hash" TEXT,
        "created_at" TIMESTAMPTZ NOT NULL
      );

      CREATE TABLE "user_settings" (
        "key" TEXT PRIMARY KEY,
        "value" TEXT,
        "updated_at" TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE TABLE "groups" (
        "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        "name" TEXT NOT NULL UNIQUE,
        "description" TEXT,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        "updated_at" TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE TABLE "user_groups" (
        "user_id" UUID NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
        "group_id" UUID NOT NULL REFERENCES "groups"("id") ON DELETE CASCADE,
        PRIMARY KEY ("user_id", "group_id")
      );

      CREATE TABLE "organizations" (
        "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        "name" TEXT NOT NULL UNIQUE,
        "description" TEXT,
        "is_personal" BOOLEAN NOT NULL DEFAULT FALSE,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        "updated_at" TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE TABLE "user_organizations" (
        "user_id" UUID NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
        "organization_id" UUID NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
        "joined_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        "is_admin" BOOLEAN NOT NULL DEFAULT FALSE,
        PRIMARY KEY ("user_id", "organization_id")
      );

      ALTER TABLE "users" ADD COLUMN "personal_organization_id" UUID REFERENCES "organizations"("id") ON DELETE SET NULL;
    `);

    // 3. Virtual Filesystem (VFS) Core
    await pool.query(`
      CREATE TABLE "vfs_registry" (
        "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        "object_type" TEXT NOT NULL,
        "owner_id" UUID REFERENCES "users"("id") ON DELETE CASCADE,
        "organization_id" UUID NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
        "encrypted_name" TEXT,
        "encrypted_session_key" TEXT,
        "public_hierarchical_key" TEXT,
        "encrypted_private_hierarchical_key" TEXT,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX "vfs_registry_owner_idx" ON "vfs_registry" ("owner_id");
      CREATE INDEX "vfs_registry_org_idx" ON "vfs_registry" ("organization_id");
      CREATE INDEX "vfs_registry_type_idx" ON "vfs_registry" ("object_type");

      CREATE TABLE "vfs_links" (
        "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        "parent_id" UUID NOT NULL REFERENCES "vfs_registry"("id") ON DELETE CASCADE,
        "child_id" UUID NOT NULL REFERENCES "vfs_registry"("id") ON DELETE CASCADE,
        "wrapped_session_key" TEXT NOT NULL,
        "wrapped_hierarchical_key" TEXT,
        "visible_children" JSONB,
        "position" INTEGER,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE UNIQUE INDEX "vfs_links_parent_child_idx" ON "vfs_links" ("parent_id", "child_id");
      CREATE INDEX "vfs_links_child_idx" ON "vfs_links" ("child_id");

      CREATE TABLE "vfs_acl_entries" (
        "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        "item_id" UUID NOT NULL REFERENCES "vfs_registry"("id") ON DELETE CASCADE,
        "principal_type" TEXT NOT NULL CHECK ("principal_type" IN ('user', 'group', 'organization')),
        "principal_id" UUID NOT NULL,
        "access_level" TEXT NOT NULL CHECK ("access_level" IN ('read', 'write', 'admin')),
        "wrapped_session_key" TEXT,
        "wrapped_hierarchical_key" TEXT,
        "key_epoch" INTEGER,
        "granted_by" UUID REFERENCES "users"("id") ON DELETE RESTRICT,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        "updated_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        "expires_at" TIMESTAMPTZ,
        "revoked_at" TIMESTAMPTZ
      );
      CREATE UNIQUE INDEX "vfs_acl_entries_item_principal_idx" ON "vfs_acl_entries" ("item_id", "principal_type", "principal_id");
      CREATE INDEX "vfs_acl_entries_principal_idx" ON "vfs_acl_entries" ("principal_type", "principal_id");

      CREATE TABLE "vfs_item_state" (
        "item_id" UUID PRIMARY KEY REFERENCES "vfs_registry"("id") ON DELETE CASCADE,
        "encrypted_payload" TEXT,
        "key_epoch" INTEGER,
        "encryption_nonce" TEXT,
        "encryption_aad" TEXT,
        "encryption_signature" TEXT,
        "updated_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        "deleted_at" TIMESTAMPTZ
      );
    `);

    // 4. Sync, CRDT & Event Log
    await pool.query(`
      CREATE TABLE "vfs_sync_changes" (
        "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        "item_id" UUID NOT NULL REFERENCES "vfs_registry"("id") ON DELETE CASCADE,
        "change_type" TEXT NOT NULL CHECK ("change_type" IN ('upsert', 'delete', 'acl')),
        "changed_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        "changed_by" UUID REFERENCES "users"("id") ON DELETE SET NULL,
        "root_id" UUID REFERENCES "vfs_registry"("id") ON DELETE SET NULL
      );
      CREATE INDEX "vfs_sync_changes_item_idx" ON "vfs_sync_changes" ("item_id");
      CREATE INDEX "vfs_sync_changes_changed_at_idx" ON "vfs_sync_changes" ("changed_at");
      CREATE INDEX "vfs_sync_changes_root_idx" ON "vfs_sync_changes" ("root_id");

      CREATE TABLE "vfs_crdt_ops" (
        "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        "item_id" UUID NOT NULL REFERENCES "vfs_registry"("id") ON DELETE CASCADE,
        "op_type" TEXT NOT NULL CHECK ("op_type" IN ('acl_add', 'acl_remove', 'link_add', 'link_remove', 'item_upsert', 'item_delete')),
        "principal_type" TEXT CHECK ("principal_type" IN ('user', 'group', 'organization')),
        "principal_id" UUID,
        "access_level" TEXT CHECK ("access_level" IN ('read', 'write', 'admin')),
        "parent_id" UUID,
        "child_id" UUID,
        "actor_id" UUID REFERENCES "users"("id") ON DELETE SET NULL,
        "source_table" TEXT NOT NULL,
        "source_id" TEXT NOT NULL,
        "occurred_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        "encrypted_payload" TEXT,
        "key_epoch" INTEGER,
        "encryption_nonce" TEXT,
        "encryption_aad" TEXT,
        "encryption_signature" TEXT,
        "encrypted_payload_bytes" BYTEA,
        "encryption_nonce_bytes" BYTEA,
        "encryption_aad_bytes" BYTEA,
        "encryption_signature_bytes" BYTEA,
        "root_id" UUID REFERENCES "vfs_registry"("id") ON DELETE SET NULL
      );
      CREATE INDEX "vfs_crdt_ops_item_idx" ON "vfs_crdt_ops" ("item_id");
      CREATE INDEX "vfs_crdt_ops_occurred_idx" ON "vfs_crdt_ops" ("occurred_at");
      CREATE INDEX "vfs_crdt_ops_root_scope_idx" ON "vfs_crdt_ops" (root_id, occurred_at, id);

      CREATE TABLE "vfs_crdt_snapshots" (
        "scope" TEXT PRIMARY KEY,
        "snapshot_version" INTEGER NOT NULL DEFAULT 1,
        "snapshot_payload" JSONB NOT NULL,
        "snapshot_cursor_changed_at" TIMESTAMPTZ,
        "snapshot_cursor_change_id" UUID,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        "updated_at" TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE TABLE "vfs_crdt_replica_heads" (
        "actor_id" UUID NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
        "replica_id" TEXT NOT NULL,
        "max_write_id" BIGINT NOT NULL,
        "max_occurred_at" TIMESTAMPTZ NOT NULL,
        "updated_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY ("actor_id", "replica_id")
      );

      CREATE TABLE "vfs_sync_client_state" (
        "user_id" UUID NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
        "client_id" TEXT NOT NULL,
        "last_reconciled_at" TIMESTAMPTZ NOT NULL,
        "last_reconciled_change_id" UUID NOT NULL,
        "last_reconciled_write_ids" JSONB NOT NULL DEFAULT '{}'::jsonb,
        "updated_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY ("user_id", "client_id")
      );
    `);

    // 5. Core Functions & Triggers
    await pool.query(`
      CREATE OR REPLACE FUNCTION "vfs_make_event_id"(prefix TEXT)
      RETURNS UUID LANGUAGE SQL AS $$ SELECT gen_random_uuid() $$;

      CREATE OR REPLACE FUNCTION "vfs_emit_sync_change"(
        p_item_id UUID,
        p_change_type TEXT,
        p_changed_by UUID,
        p_root_id UUID
      )
      RETURNS VOID LANGUAGE plpgsql AS $$
      BEGIN
        INSERT INTO "vfs_sync_changes" (id, item_id, change_type, changed_at, changed_by, root_id)
        VALUES (gen_random_uuid(), p_item_id, p_change_type, NOW(), p_changed_by, p_root_id);
      END;
      $$;

      CREATE OR REPLACE FUNCTION "vfs_emit_sync_change_tg"()
      RETURNS TRIGGER LANGUAGE plpgsql AS $$
      BEGIN
        IF TG_TABLE_NAME = 'vfs_registry' THEN
          IF TG_OP = 'DELETE' THEN
            PERFORM "vfs_emit_sync_change"(OLD.id, 'delete', OLD.owner_id, NULL);
            RETURN OLD;
          ELSE
            PERFORM "vfs_emit_sync_change"(NEW.id, 'upsert', NEW.owner_id, NULL);
            RETURN NEW;
          END IF;
        ELSIF TG_TABLE_NAME = 'vfs_links' THEN
          IF TG_OP = 'DELETE' THEN
            PERFORM "vfs_emit_sync_change"(OLD.child_id, 'upsert', NULL, OLD.parent_id);
            INSERT INTO "vfs_crdt_ops" (item_id, op_type, parent_id, child_id, source_table, source_id, root_id)
            VALUES (OLD.child_id, 'link_remove', OLD.parent_id, OLD.child_id, 'vfs_links', OLD.id::uuid, OLD.parent_id);
            RETURN OLD;
          ELSE
            PERFORM "vfs_emit_sync_change"(NEW.child_id, 'upsert', NULL, NEW.parent_id);
            INSERT INTO "vfs_crdt_ops" (item_id, op_type, parent_id, child_id, source_table, source_id, root_id)
            VALUES (NEW.child_id, 'link_add', NEW.parent_id, NEW.child_id, 'vfs_links', NEW.id::uuid, NEW.parent_id);
            RETURN NEW;
          END IF;
        ELSIF TG_TABLE_NAME = 'vfs_acl_entries' THEN
          IF TG_OP = 'DELETE' THEN
            PERFORM "vfs_emit_sync_change"(OLD.item_id, 'acl', OLD.granted_by, OLD.item_id);
            INSERT INTO "vfs_crdt_ops" (
              item_id,
              op_type,
              principal_type,
              principal_id,
              access_level,
              actor_id,
              source_table,
              source_id,
              root_id
            )
            VALUES (
              OLD.item_id,
              'acl_remove',
              OLD.principal_type,
              OLD.principal_id,
              OLD.access_level,
              OLD.granted_by,
              'vfs_acl_entries',
              OLD.id,
              OLD.item_id
            );
            RETURN OLD;
          ELSIF TG_OP = 'UPDATE' AND NEW.revoked_at IS NOT NULL THEN
            PERFORM "vfs_emit_sync_change"(NEW.item_id, 'acl', NEW.granted_by, NEW.item_id);
            INSERT INTO "vfs_crdt_ops" (
              item_id,
              op_type,
              principal_type,
              principal_id,
              access_level,
              actor_id,
              source_table,
              source_id,
              root_id
            )
            VALUES (
              NEW.item_id,
              'acl_remove',
              NEW.principal_type,
              NEW.principal_id,
              NEW.access_level,
              NEW.granted_by,
              'vfs_acl_entries',
              NEW.id,
              NEW.item_id
            );
            RETURN NEW;
          ELSE
            PERFORM "vfs_emit_sync_change"(NEW.item_id, 'acl', NEW.granted_by, NEW.item_id);
            INSERT INTO "vfs_crdt_ops" (
              item_id,
              op_type,
              principal_type,
              principal_id,
              access_level,
              actor_id,
              source_table,
              source_id,
              root_id
            )
            VALUES (
              NEW.item_id,
              'acl_add',
              NEW.principal_type,
              NEW.principal_id,
              NEW.access_level,
              NEW.granted_by,
              'vfs_acl_entries',
              NEW.id,
              NEW.item_id
            );
            RETURN NEW;
          END IF;
        END IF;
        RETURN NULL;
      END;
      $$;

      CREATE TRIGGER "tg_vfs_registry_sync" AFTER INSERT OR UPDATE OR DELETE ON "vfs_registry" FOR EACH ROW EXECUTE FUNCTION "vfs_emit_sync_change_tg"();
      CREATE TRIGGER "tg_vfs_links_sync" AFTER INSERT OR DELETE ON "vfs_links" FOR EACH ROW EXECUTE FUNCTION "vfs_emit_sync_change_tg"();
      CREATE TRIGGER "tg_vfs_acl_entries_sync" AFTER INSERT OR UPDATE OR DELETE ON "vfs_acl_entries" FOR EACH ROW EXECUTE FUNCTION "vfs_emit_sync_change_tg"();
    `);
  }
};
