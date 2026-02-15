import type { Pool } from 'pg';
import type { Migration } from './types.js';

/**
 * v045: Canonicalize active legacy org-share ACL identifiers.
 *
 * Rewrites active legacy ACL ids of the form `org-share:<shareId>` into
 * canonical source-attributed ids `org-share:<sourceOrgId>:<shareId>`.
 *
 * Source org inference is fail-closed:
 * - each legacy row must resolve to exactly one source org via `granted_by`
 *   membership in `user_organizations`
 * - malformed source/share id parts are rejected
 * - existing canonical id collisions are rejected
 */
export const v045: Migration = {
  version: 45,
  description: 'Canonicalize active legacy org-share ACL identifiers',
  up: async (pool: Pool) => {
    await pool.query('BEGIN');
    try {
      await pool.query(`
        DO $$
        DECLARE
          legacy_total BIGINT;
          resolvable_total BIGINT;
          invalid_source_total BIGINT;
          invalid_share_total BIGINT;
          conflict_total BIGINT;
        BEGIN
          IF NOT EXISTS (
            SELECT 1
            FROM "schema_migrations"
            WHERE "version" = 44
          ) THEN
            RAISE EXCEPTION
              'v045 abort: v044 must be recorded before org-share ACL canonicalization';
          END IF;

          IF to_regclass('public.vfs_acl_entries') IS NULL THEN
            RAISE EXCEPTION
              'v045 abort: vfs_acl_entries missing before org-share ACL canonicalization';
          END IF;

          IF to_regclass('public.user_organizations') IS NULL THEN
            RAISE EXCEPTION
              'v045 abort: user_organizations missing before org-share ACL canonicalization';
          END IF;

          CREATE TEMP TABLE "_v045_legacy_org_share_acl" ON COMMIT DROP AS
          SELECT
            acl.id AS legacy_acl_id,
            SUBSTRING(acl.id FROM 11) AS legacy_share_id,
            acl.granted_by
          FROM "vfs_acl_entries" acl
          WHERE acl.principal_type = 'organization'
            AND acl.revoked_at IS NULL
            AND acl.id LIKE 'org-share:%'
            AND acl.id NOT LIKE 'org-share:%:%';

          SELECT COUNT(*) INTO legacy_total
          FROM "_v045_legacy_org_share_acl";

          IF legacy_total = 0 THEN
            RETURN;
          END IF;

          CREATE TEMP TABLE "_v045_resolved_org_share_acl" ON COMMIT DROP AS
          WITH source_candidates AS (
            SELECT
              legacy.legacy_acl_id,
              legacy.legacy_share_id,
              uo.organization_id AS source_org_id,
              COUNT(uo.organization_id) OVER (
                PARTITION BY legacy.legacy_acl_id
              ) AS source_org_count,
              ROW_NUMBER() OVER (
                PARTITION BY legacy.legacy_acl_id
                ORDER BY uo.organization_id
              ) AS source_org_rank
            FROM "_v045_legacy_org_share_acl" legacy
            LEFT JOIN "user_organizations" uo
              ON uo.user_id = legacy.granted_by
          )
          SELECT
            source_candidates.legacy_acl_id,
            source_candidates.legacy_share_id,
            source_candidates.source_org_id,
            'org-share:' || source_candidates.source_org_id || ':' || source_candidates.legacy_share_id AS canonical_acl_id
          FROM source_candidates
          WHERE source_candidates.source_org_count = 1
            AND source_candidates.source_org_rank = 1
            AND source_candidates.source_org_id IS NOT NULL;

          SELECT COUNT(*) INTO resolvable_total
          FROM "_v045_resolved_org_share_acl";

          IF resolvable_total <> legacy_total THEN
            RAISE EXCEPTION
              'v045 abort: active legacy org-share ACL rows are not uniquely source-resolvable';
          END IF;

          SELECT COUNT(*) INTO invalid_source_total
          FROM "_v045_resolved_org_share_acl"
          WHERE source_org_id = ''
             OR source_org_id LIKE '%:%';

          IF invalid_source_total > 0 THEN
            RAISE EXCEPTION
              'v045 abort: canonicalized source org ids contain unsupported separators';
          END IF;

          SELECT COUNT(*) INTO invalid_share_total
          FROM "_v045_resolved_org_share_acl"
          WHERE legacy_share_id = ''
             OR legacy_share_id LIKE '%:%';

          IF invalid_share_total > 0 THEN
            RAISE EXCEPTION
              'v045 abort: canonicalized share ids contain unsupported separators';
          END IF;

          SELECT COUNT(*) INTO conflict_total
          FROM "_v045_resolved_org_share_acl" resolved
          INNER JOIN "vfs_acl_entries" acl
            ON acl.id = resolved.canonical_acl_id
           AND acl.id <> resolved.legacy_acl_id;

          IF conflict_total > 0 THEN
            RAISE EXCEPTION
              'v045 abort: canonicalized org-share ACL ids would collide with existing ACL ids';
          END IF;

          UPDATE "vfs_acl_entries" acl
             SET id = resolved.canonical_acl_id
            FROM "_v045_resolved_org_share_acl" resolved
           WHERE acl.id = resolved.legacy_acl_id;

          IF EXISTS (
            SELECT 1
            FROM "vfs_acl_entries" acl
            WHERE acl.principal_type = 'organization'
              AND acl.revoked_at IS NULL
              AND acl.id LIKE 'org-share:%'
              AND acl.id NOT LIKE 'org-share:%:%'
          ) THEN
            RAISE EXCEPTION
              'v045 abort: active legacy org-share ACL ids remain after canonicalization';
          END IF;
        END;
        $$;
      `);

      await pool.query('COMMIT');
    } catch (error) {
      await pool.query('ROLLBACK');
      throw error;
    }
  }
};
