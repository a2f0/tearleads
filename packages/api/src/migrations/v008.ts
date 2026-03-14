import type { Pool } from 'pg';
import type { Migration } from './types.js';

/**
 * v008: Add blob sync relations consumed by CRDT pull and manifest reads.
 *
 * The live blob attach flow still persists canonical attachment edges in
 * vfs_links. This migration exposes those edges through vfs_blob_refs and adds
 * the manifest/object relations needed by sync enrichment.
 */
export const v008: Migration = {
  version: 8,
  description: 'Add blob sync relations',
  up: async (pool: Pool) => {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS "vfs_blob_objects" (
        "id" UUID PRIMARY KEY REFERENCES "vfs_registry"("id") ON DELETE CASCADE,
        "sha256" TEXT NOT NULL DEFAULT '',
        "size_bytes" INTEGER NOT NULL DEFAULT 0,
        "storage_key" TEXT NOT NULL,
        "created_by" UUID NOT NULL REFERENCES "users"("id") ON DELETE RESTRICT,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE UNIQUE INDEX IF NOT EXISTS "vfs_blob_objects_storage_key_idx"
        ON "vfs_blob_objects" ("storage_key");
      CREATE INDEX IF NOT EXISTS "vfs_blob_objects_sha_idx"
        ON "vfs_blob_objects" ("sha256");

      INSERT INTO "vfs_blob_objects" (
        "id",
        "sha256",
        "size_bytes",
        "storage_key",
        "created_by",
        "created_at"
      )
      SELECT
        registry.id,
        ''::text,
        0,
        registry.id::text,
        registry.owner_id,
        registry.created_at
      FROM "vfs_registry" AS registry
      WHERE registry.object_type = 'file'
        AND registry.owner_id IS NOT NULL
      ON CONFLICT ("id") DO NOTHING;

      CREATE TABLE IF NOT EXISTS "vfs_blob_manifests" (
        "blob_id" UUID PRIMARY KEY REFERENCES "vfs_blob_objects"("id") ON DELETE CASCADE,
        "key_epoch" INTEGER NOT NULL,
        "chunk_count" INTEGER NOT NULL,
        "total_plaintext_bytes" INTEGER NOT NULL,
        "total_ciphertext_bytes" INTEGER NOT NULL,
        "chunk_hashes" JSONB NOT NULL,
        "chunk_boundaries" JSONB NOT NULL,
        "manifest_hash" TEXT NOT NULL,
        "manifest_signature" TEXT NOT NULL,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE OR REPLACE VIEW "vfs_blob_refs" AS
      SELECT
        links.id,
        links.child_id AS blob_id,
        links.parent_id AS item_id,
        COALESCE(
          NULLIF(links.visible_children::jsonb ->> 'relationKind', ''),
          NULLIF(
            substring(links.wrapped_session_key FROM '^blob-link:(.+)$'),
            ''
          ),
          'file'
        ) AS relation_kind,
        CASE
          WHEN COALESCE(links.visible_children::jsonb ->> 'attachedBy', '') ~*
            '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
          THEN (links.visible_children::jsonb ->> 'attachedBy')::uuid
          ELSE blob_registry.owner_id
        END AS attached_by,
        links.created_at AS attached_at
      FROM "vfs_links" AS links
      INNER JOIN "vfs_registry" AS blob_registry
        ON blob_registry.id = links.child_id
      WHERE links.wrapped_session_key LIKE 'blob-link:%'
        AND blob_registry.object_type = 'file';
    `);
  }
};
