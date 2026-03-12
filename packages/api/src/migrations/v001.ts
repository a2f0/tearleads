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
    // Enable UUID generation
    await pool.query('CREATE EXTENSION IF NOT EXISTS "pgcrypto"');

    // Schema migrations table (must exist for the runner)
    await pool.query(`
      CREATE TABLE IF NOT EXISTS "schema_migrations" (
        "version" INTEGER PRIMARY KEY,
        "applied_at" TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    // 1. Identity & Access
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

    // 2. Virtual Filesystem (VFS) Core
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

    // 3. Sync, CRDT & Event Log
    await pool.query(`
      CREATE TABLE "vfs_sync_changes" (
        "id" TEXT PRIMARY KEY,
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
        "root_id" UUID
      );
      CREATE INDEX "vfs_crdt_ops_item_idx" ON "vfs_crdt_ops" ("item_id");
      CREATE INDEX "vfs_crdt_ops_occurred_idx" ON "vfs_crdt_ops" ("occurred_at");
      CREATE INDEX "vfs_crdt_ops_root_scope_idx" ON "vfs_crdt_ops" (root_id, occurred_at, id);

      CREATE TABLE "vfs_crdt_snapshots" (
        "scope" TEXT PRIMARY KEY,
        "snapshot_version" INTEGER NOT NULL DEFAULT 1,
        "snapshot_payload" JSONB NOT NULL,
        "snapshot_cursor_changed_at" TIMESTAMPTZ,
        "snapshot_cursor_change_id" TEXT,
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
        "last_reconciled_change_id" TEXT NOT NULL,
        "last_reconciled_write_ids" JSONB NOT NULL DEFAULT '{}'::jsonb,
        "updated_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY ("user_id", "client_id")
      );
    `);

    // 4. Core Functions & Triggers
    await pool.query(`
      CREATE OR REPLACE FUNCTION "vfs_make_event_id"(prefix TEXT)
      RETURNS UUID LANGUAGE SQL AS $$ SELECT gen_random_uuid() $$;

      CREATE OR REPLACE FUNCTION "vfs_emit_sync_change"()
      RETURNS TRIGGER LANGUAGE plpgsql AS $$
      BEGIN
        IF TG_TABLE_NAME = 'vfs_registry' THEN
          IF TG_OP = 'DELETE' THEN
            INSERT INTO "vfs_sync_changes" (id, item_id, change_type, changed_at, changed_by)
            VALUES (gen_random_uuid()::text, OLD.id, 'delete', NOW(), OLD.owner_id);
            RETURN OLD;
          ELSE
            INSERT INTO "vfs_sync_changes" (id, item_id, change_type, changed_at, changed_by)
            VALUES (gen_random_uuid()::text, NEW.id, 'upsert', NOW(), NEW.owner_id);
            RETURN NEW;
          END IF;
        ELSIF TG_TABLE_NAME = 'vfs_links' THEN
          IF TG_OP = 'DELETE' THEN
            INSERT INTO "vfs_sync_changes" (id, item_id, change_type, changed_at, root_id)
            VALUES (gen_random_uuid()::text, OLD.child_id, 'upsert', NOW(), OLD.parent_id);
            INSERT INTO "vfs_crdt_ops" (item_id, op_type, parent_id, child_id, source_table, source_id)
            VALUES (OLD.child_id, 'link_remove', OLD.parent_id, OLD.child_id, 'vfs_links', OLD.id::text);
            RETURN OLD;
          ELSE
            INSERT INTO "vfs_sync_changes" (id, item_id, change_type, changed_at, root_id)
            VALUES (gen_random_uuid()::text, NEW.child_id, 'upsert', NOW(), NEW.parent_id);
            INSERT INTO "vfs_crdt_ops" (item_id, op_type, parent_id, child_id, source_table, source_id)
            VALUES (NEW.child_id, 'link_add', NEW.parent_id, NEW.child_id, 'vfs_links', NEW.id::text);
            RETURN NEW;
          END IF;
        END IF;
        RETURN NULL;
      END;
      $$;

      CREATE TRIGGER "tg_vfs_registry_sync" AFTER INSERT OR UPDATE OR DELETE ON "vfs_registry" FOR EACH ROW EXECUTE FUNCTION "vfs_emit_sync_change"();
      CREATE TRIGGER "tg_vfs_links_sync" AFTER INSERT OR DELETE ON "vfs_links" FOR EACH ROW EXECUTE FUNCTION "vfs_emit_sync_change"();
    `);
  }
};
