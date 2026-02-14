import type { Pool } from 'pg';
import { describe, expect, it, vi } from 'vitest';
import { getCurrentVersion, migrations, runMigrations } from './index.js';
import type { Migration } from './types.js';

interface MockQueryResult {
  rows: Array<{ version: number | null }>;
  rowCount: number;
}

function createMockPool(
  queryResponses: Map<string, MockQueryResult>
): Pool & { queries: string[] } {
  const queries: string[] = [];

  return {
    queries,
    query: vi.fn().mockImplementation((sql: string) => {
      queries.push(sql);

      // Check for pattern matches
      for (const [pattern, response] of queryResponses.entries()) {
        if (sql.includes(pattern)) {
          return Promise.resolve(response);
        }
      }

      // Default empty response
      return Promise.resolve({ rows: [], rowCount: 0 });
    })
  } as unknown as Pool & { queries: string[] };
}

describe('migrations', () => {
  describe('getCurrentVersion', () => {
    it('returns 0 when table does not exist', async () => {
      const pool = createMockPool(new Map());
      vi.mocked(pool.query).mockRejectedValueOnce(
        new Error('relation "schema_migrations" does not exist')
      );

      const version = await getCurrentVersion(pool);

      expect(version).toBe(0);
    });

    it('returns 0 when table is empty', async () => {
      const pool = createMockPool(
        new Map([['MAX(version)', { rows: [{ version: null }], rowCount: 1 }]])
      );

      const version = await getCurrentVersion(pool);

      expect(version).toBe(0);
    });

    it('returns the max version from database', async () => {
      const pool = createMockPool(
        new Map([['MAX(version)', { rows: [{ version: 3 }], rowCount: 1 }]])
      );

      const version = await getCurrentVersion(pool);

      expect(version).toBe(3);
    });
  });

  describe('migrations array', () => {
    it('has v001 as first migration', () => {
      expect(migrations[0]?.version).toBe(1);
    });

    it('has sequential versions', () => {
      const versions = migrations.map((m: Migration) => m.version);
      for (let i = 0; i < versions.length; i++) {
        expect(versions[i]).toBe(i + 1);
      }
    });

    it('each migration has required fields', () => {
      for (const migration of migrations) {
        expect(migration.version).toBeGreaterThan(0);
        expect(migration.description).toBeTruthy();
        expect(typeof migration.up).toBe('function');
      }
    });
  });

  describe('runMigrations', () => {
    it('applies v001 and records it on fresh database', async () => {
      let versionCallCount = 0;
      const pool = {
        queries: [] as string[],
        query: vi.fn().mockImplementation((sql: string) => {
          (pool as { queries: string[] }).queries.push(sql);

          // First call to MAX(version) returns null (fresh db)
          // Second call returns 1 (after recording v001)
          if (sql.includes('MAX(version)')) {
            versionCallCount++;
            if (versionCallCount === 1) {
              return Promise.resolve({
                rows: [{ version: null }],
                rowCount: 1
              });
            }
            return Promise.resolve({ rows: [{ version: 1 }], rowCount: 1 });
          }

          return Promise.resolve({ rows: [], rowCount: 0 });
        })
      } as unknown as Pool & { queries: string[] };

      const result = await runMigrations(pool);

      // v001 should be applied
      expect(result.applied).toContain(1);
      expect(result.currentVersion).toBe(1);

      // Should have recorded the migration
      expect(
        pool.queries.some((q) => q.includes('INSERT INTO schema_migrations'))
      ).toBe(true);
    });

    it('skips already applied migrations', async () => {
      const pool = createMockPool(
        new Map([['MAX(version)', { rows: [{ version: 28 }], rowCount: 1 }]])
      );

      const result = await runMigrations(pool);

      // No new migrations should be applied
      expect(result.applied).toEqual([]);
      expect(result.currentVersion).toBe(28);
    });

    it('applies pending migrations when behind', async () => {
      let versionCallCount = 0;
      const pool = createMockPool(new Map());
      vi.mocked(pool.query).mockImplementation((sql: string) => {
        pool.queries.push(sql);

        if (sql.includes('MAX(version)')) {
          versionCallCount++;
          if (versionCallCount === 1) {
            return Promise.resolve({
              rows: [{ version: 1 }],
              rowCount: 1
            });
          }
          return Promise.resolve({ rows: [{ version: 28 }], rowCount: 1 });
        }

        return Promise.resolve({ rows: [], rowCount: 0 });
      });

      const result = await runMigrations(pool);

      expect(result.applied).toEqual([
        2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21,
        22, 23, 24, 25, 26, 27, 28
      ]);
      expect(result.currentVersion).toBe(28);
    });
  });

  describe('v001 migration', () => {
    it('creates all required tables', async () => {
      const pool = createMockPool(new Map());

      const v001 = migrations.find((m: Migration) => m.version === 1);
      if (!v001) {
        throw new Error('v001 migration not found');
      }

      await v001.up(pool);

      const queries = pool.queries.join('\n');

      // Check all tables are created
      expect(queries).toContain(
        'CREATE TABLE IF NOT EXISTS "schema_migrations"'
      );
      expect(queries).toContain('CREATE TABLE IF NOT EXISTS "sync_metadata"');
      expect(queries).toContain('CREATE TABLE IF NOT EXISTS "user_settings"');
      expect(queries).toContain('CREATE TABLE IF NOT EXISTS "users"');
      expect(queries).toContain(
        'CREATE TABLE IF NOT EXISTS "user_credentials"'
      );
      expect(queries).toContain('CREATE TABLE IF NOT EXISTS "secrets"');
      expect(queries).toContain('CREATE TABLE IF NOT EXISTS "files"');
      expect(queries).toContain('CREATE TABLE IF NOT EXISTS "contacts"');
      expect(queries).toContain('CREATE TABLE IF NOT EXISTS "contact_phones"');
      expect(queries).toContain('CREATE TABLE IF NOT EXISTS "contact_emails"');
      expect(queries).toContain(
        'CREATE TABLE IF NOT EXISTS "analytics_events"'
      );
      expect(queries).toContain('CREATE TABLE IF NOT EXISTS "notes"');
    });

    it('creates required indexes', async () => {
      const pool = createMockPool(new Map());

      const v001 = migrations.find((m: Migration) => m.version === 1);
      if (!v001) {
        throw new Error('v001 migration not found');
      }
      await v001.up(pool);

      const queries = pool.queries.join('\n');

      // Check key indexes
      expect(queries).toContain('CREATE INDEX IF NOT EXISTS "entity_idx"');
      expect(queries).toContain('CREATE INDEX IF NOT EXISTS "users_email_idx"');
      expect(queries).toContain(
        'CREATE INDEX IF NOT EXISTS "analytics_events_timestamp_idx"'
      );
      expect(queries).toContain(
        'CREATE INDEX IF NOT EXISTS "notes_updated_at_idx"'
      );
    });

    it('uses PostgreSQL-specific types', async () => {
      const pool = createMockPool(new Map());

      const v001 = migrations.find((m: Migration) => m.version === 1);
      if (!v001) {
        throw new Error('v001 migration not found');
      }
      await v001.up(pool);

      const queries = pool.queries.join('\n');

      // Check PostgreSQL types
      expect(queries).toContain('TIMESTAMPTZ');
      expect(queries).toContain('BOOLEAN');
      expect(queries).toContain('JSONB');
    });
  });

  describe('v002 migration', () => {
    it('adds the analytics_events detail column', async () => {
      const pool = createMockPool(new Map());

      const v002 = migrations.find((m: Migration) => m.version === 2);
      if (!v002) {
        throw new Error('v002 migration not found');
      }

      await v002.up(pool);

      expect(pool.queries.join('\n')).toContain(
        'ALTER TABLE "analytics_events" ADD COLUMN IF NOT EXISTS "detail" JSONB'
      );
    });
  });

  describe('v003 migration', () => {
    it('creates notes table and indexes', async () => {
      const pool = createMockPool(new Map());

      const v003 = migrations.find((m: Migration) => m.version === 3);
      if (!v003) {
        throw new Error('v003 migration not found');
      }

      await v003.up(pool);

      const queries = pool.queries.join('\n');
      expect(queries).toContain('CREATE TABLE IF NOT EXISTS "notes"');
      expect(queries).toContain(
        'CREATE INDEX IF NOT EXISTS "notes_updated_at_idx"'
      );
      expect(queries).toContain('CREATE INDEX IF NOT EXISTS "notes_title_idx"');
    });
  });

  describe('v004 migration', () => {
    it('creates users and user_credentials tables', async () => {
      const pool = createMockPool(new Map());

      const v004 = migrations.find((m: Migration) => m.version === 4);
      if (!v004) {
        throw new Error('v004 migration not found');
      }

      await v004.up(pool);

      const queries = pool.queries.join('\n');
      expect(queries).toContain('CREATE TABLE IF NOT EXISTS "users"');
      expect(queries).toContain('CREATE INDEX IF NOT EXISTS "users_email_idx"');
      expect(queries).toContain(
        'CREATE TABLE IF NOT EXISTS "user_credentials"'
      );
    });
  });

  describe('v006 migration', () => {
    it('creates groups and user_groups tables', async () => {
      const pool = createMockPool(new Map());

      const v006 = migrations.find((m: Migration) => m.version === 6);
      if (!v006) {
        throw new Error('v006 migration not found');
      }

      await v006.up(pool);

      const queries = pool.queries.join('\n');
      expect(queries).toContain('CREATE TABLE IF NOT EXISTS "groups"');
      expect(queries).toContain(
        'CREATE UNIQUE INDEX IF NOT EXISTS "groups_name_idx"'
      );
      expect(queries).toContain('CREATE TABLE IF NOT EXISTS "user_groups"');
      expect(queries).toContain(
        'CREATE INDEX IF NOT EXISTS "user_groups_group_idx"'
      );
    });
  });

  describe('v016 migration', () => {
    it('adds is_admin column to user_organizations table', async () => {
      const pool = createMockPool(new Map());

      const v016 = migrations.find((m: Migration) => m.version === 16);
      if (!v016) {
        throw new Error('v016 migration not found');
      }

      await v016.up(pool);

      const queries = pool.queries.join('\n');
      expect(queries).toContain('ALTER TABLE "user_organizations"');
      expect(queries).toContain('"is_admin" BOOLEAN NOT NULL DEFAULT FALSE');
    });
  });

  describe('v018 migration', () => {
    it('adds personal organization linkage for users', async () => {
      const pool = createMockPool(new Map());

      const v018 = migrations.find((m: Migration) => m.version === 18);
      if (!v018) {
        throw new Error('v018 migration not found');
      }

      await v018.up(pool);

      const queries = pool.queries.join('\n');
      expect(queries).toContain('ADD COLUMN IF NOT EXISTS "is_personal"');
      expect(queries).toContain(
        'ADD COLUMN IF NOT EXISTS "personal_organization_id" TEXT'
      );
      expect(queries).toContain('users_personal_organization_id_fkey');
      expect(queries).toContain('users_personal_organization_id_idx');
      expect(queries).toContain('"personal_organization_id" SET NOT NULL');
    });
  });

  describe('v019 migration', () => {
    it('creates organization billing and RevenueCat event tables', async () => {
      const pool = createMockPool(new Map());

      const v019 = migrations.find((m: Migration) => m.version === 19);
      if (!v019) {
        throw new Error('v019 migration not found');
      }

      await v019.up(pool);

      const queries = pool.queries.join('\n');
      expect(queries).toContain(
        'CREATE TABLE IF NOT EXISTS "organization_billing_accounts"'
      );
      expect(queries).toContain(
        'CREATE TABLE IF NOT EXISTS "revenuecat_webhook_events"'
      );
      expect(queries).toContain("'org:' || o.id");
      expect(queries).toContain('INSERT INTO organization_billing_accounts');
    });
  });

  describe('v020 migration', () => {
    it('adds org scope and membership guardrails for MLS data', async () => {
      const pool = createMockPool(new Map());

      const v020 = migrations.find((m: Migration) => m.version === 20);
      if (!v020) {
        throw new Error('v020 migration not found');
      }

      await v020.up(pool);

      const queries = pool.queries.join('\n');
      expect(queries).toContain('ALTER TABLE "mls_groups"');
      expect(queries).toContain('"organization_id" TEXT');
      expect(queries).toContain('"mls_groups_organization_id_fkey"');
      expect(queries).toContain('"mls_groups_org_idx"');
      expect(queries).toContain('"mls_key_packages_consumed_by_group_id_fkey"');
      expect(queries).toContain('enforce_mls_group_member_org_boundary');
      expect(queries).toContain('mls_group_members_org_boundary_trigger');
    });
  });

  describe('v021 migration', () => {
    it('creates per-client sync cursor state table', async () => {
      const pool = createMockPool(new Map());

      const v021 = migrations.find((m: Migration) => m.version === 21);
      if (!v021) {
        throw new Error('v021 migration not found');
      }

      await v021.up(pool);

      const queries = pool.queries.join('\n');
      expect(queries).toContain(
        'CREATE TABLE IF NOT EXISTS "vfs_sync_client_state"'
      );
      expect(queries).toContain(
        'CREATE INDEX IF NOT EXISTS "vfs_sync_client_state_user_idx"'
      );
    });
  });

  describe('v022 migration', () => {
    it('creates blob tables and CRDT sync triggers', async () => {
      const pool = createMockPool(new Map());

      const v022 = migrations.find((m: Migration) => m.version === 22);
      if (!v022) {
        throw new Error('v022 migration not found');
      }

      await v022.up(pool);

      const queries = pool.queries.join('\n');
      expect(queries).toContain(
        'CREATE TABLE IF NOT EXISTS "vfs_blob_objects"'
      );
      expect(queries).toContain(
        'CREATE TABLE IF NOT EXISTS "vfs_blob_staging"'
      );
      expect(queries).toContain('CREATE TABLE IF NOT EXISTS "vfs_blob_refs"');
      expect(queries).toContain('CREATE TABLE IF NOT EXISTS "vfs_crdt_ops"');
      expect(queries).toContain(
        'CREATE OR REPLACE FUNCTION "vfs_emit_sync_change"'
      );
      expect(queries).toContain(
        'CREATE OR REPLACE FUNCTION "vfs_links_emit_sync_crdt_trigger"'
      );
      expect(queries).toContain(
        'CREATE TRIGGER "vfs_shares_emit_sync_crdt_trigger"'
      );
      expect(queries).toContain(
        'CREATE TRIGGER "org_shares_emit_sync_crdt_trigger"'
      );
      expect(queries).toContain(
        'CREATE TRIGGER "vfs_links_emit_sync_crdt_trigger"'
      );
    });

    it('uses transactional and idempotent trigger guardrails', async () => {
      const pool = createMockPool(new Map());

      const v022 = migrations.find((m: Migration) => m.version === 22);
      if (!v022) {
        throw new Error('v022 migration not found');
      }

      await v022.up(pool);

      expect(pool.queries[0]).toBe('BEGIN');
      expect(pool.queries.at(-1)).toBe('COMMIT');

      const queries = pool.queries.join('\n');
      expect(queries).toContain(
        'DROP TRIGGER IF EXISTS "vfs_registry_emit_sync_trigger"'
      );
      expect(queries).toContain(
        'DROP TRIGGER IF EXISTS "vfs_shares_emit_sync_crdt_trigger"'
      );
      expect(queries).toContain(
        'DROP TRIGGER IF EXISTS "org_shares_emit_sync_crdt_trigger"'
      );
      expect(queries).toContain(
        'DROP TRIGGER IF EXISTS "vfs_links_emit_sync_crdt_trigger"'
      );
      expect(queries).toContain(
        `AFTER INSERT OR UPDATE OR DELETE ON "vfs_shares"`
      );
      expect(queries).toContain(
        `AFTER INSERT OR UPDATE OR DELETE ON "org_shares"`
      );
      expect(queries).toContain(`AFTER INSERT OR DELETE ON "vfs_links"`);
      expect(queries).toContain(`'acl_add'`);
      expect(queries).toContain(`'acl_remove'`);
      expect(queries).toContain(`'link_add'`);
      expect(queries).toContain(`'link_remove'`);
      expect(queries).toContain('PERFORM "vfs_emit_sync_change"');
      expect(queries).toContain('INSERT INTO "vfs_crdt_ops"');
    });

    it('rolls back the transaction when setup fails mid-migration', async () => {
      const pool = {
        queries: [] as string[],
        query: vi.fn().mockImplementation((sql: string) => {
          (pool as { queries: string[] }).queries.push(sql);

          if (sql.includes('CREATE TABLE IF NOT EXISTS "vfs_blob_refs"')) {
            throw new Error('forced migration failure');
          }

          return Promise.resolve({ rows: [], rowCount: 0 });
        })
      } as unknown as Pool & { queries: string[] };

      const v022 = migrations.find((m: Migration) => m.version === 22);
      if (!v022) {
        throw new Error('v022 migration not found');
      }

      await expect(v022.up(pool)).rejects.toThrow('forced migration failure');
      expect(pool.queries[0]).toBe('BEGIN');
      expect(pool.queries).toContain('ROLLBACK');
      expect(pool.queries).not.toContain('COMMIT');
    });
  });

  describe('v023 migration', () => {
    it('adds CRDT last write ids column and merge helper function', async () => {
      const pool = createMockPool(new Map());

      const v023 = migrations.find((m: Migration) => m.version === 23);
      if (!v023) {
        throw new Error('v023 migration not found');
      }

      await v023.up(pool);

      const queries = pool.queries.join('\n');
      expect(queries).toContain('ALTER TABLE "vfs_sync_client_state"');
      expect(queries).toContain(
        'ADD COLUMN IF NOT EXISTS "last_reconciled_write_ids"'
      );
      expect(queries).toContain(
        'CREATE OR REPLACE FUNCTION "vfs_merge_reconciled_write_ids"'
      );
      expect(queries).toContain('jsonb_object_agg');
      expect(queries).toContain('GREATEST');
    });

    it('remains transactional and rolls back on failure', async () => {
      const pool = {
        queries: [] as string[],
        query: vi.fn().mockImplementation((sql: string) => {
          (pool as { queries: string[] }).queries.push(sql);

          if (sql.includes('CREATE OR REPLACE FUNCTION')) {
            throw new Error('forced v023 failure');
          }

          return Promise.resolve({ rows: [], rowCount: 0 });
        })
      } as unknown as Pool & { queries: string[] };

      const v023 = migrations.find((m: Migration) => m.version === 23);
      if (!v023) {
        throw new Error('v023 migration not found');
      }

      await expect(v023.up(pool)).rejects.toThrow('forced v023 failure');
      expect(pool.queries[0]).toBe('BEGIN');
      expect(pool.queries).toContain('ROLLBACK');
      expect(pool.queries).not.toContain('COMMIT');
    });
  });

  describe('v024 migration', () => {
    it('backfills legacy blob staging rows into flattened VFS structures', async () => {
      const pool = createMockPool(new Map());

      const v024 = migrations.find((m: Migration) => m.version === 24);
      if (!v024) {
        throw new Error('v024 migration not found');
      }

      await v024.up(pool);

      const queries = pool.queries.join('\n');
      expect(queries).toContain(
        'blob object id collides with non-blob vfs_registry row'
      );
      expect(queries).toContain('INSERT INTO "vfs_registry" (');
      expect(queries).toContain("'blobStage'");
      expect(queries).toContain('INSERT INTO "vfs_links" (');
      expect(queries).toContain("'blob-stage:staged'");
      expect(queries).toContain("'blob-stage:attached'");
      expect(queries).toContain("'blob-stage:abandoned'");
      expect(queries).toContain("'attachedItemId'");
    });

    it('remains transactional and rolls back on failure', async () => {
      const pool = {
        queries: [] as string[],
        query: vi.fn().mockImplementation((sql: string) => {
          (pool as { queries: string[] }).queries.push(sql);

          if (sql.includes('INSERT INTO "vfs_links"')) {
            throw new Error('forced v024 failure');
          }

          return Promise.resolve({ rows: [], rowCount: 0 });
        })
      } as unknown as Pool & { queries: string[] };

      const v024 = migrations.find((m: Migration) => m.version === 24);
      if (!v024) {
        throw new Error('v024 migration not found');
      }

      await expect(v024.up(pool)).rejects.toThrow('forced v024 failure');
      expect(pool.queries[0]).toBe('BEGIN');
      expect(pool.queries).toContain('ROLLBACK');
      expect(pool.queries).not.toContain('COMMIT');
    });
  });

  describe('v025 migration', () => {
    it('verifies flattened backfill parity before dropping legacy blob tables', async () => {
      const pool = createMockPool(new Map());

      const v025 = migrations.find((m: Migration) => m.version === 25);
      if (!v025) {
        throw new Error('v025 migration not found');
      }

      await v025.up(pool);

      const queries = pool.queries.join('\n');
      expect(queries).toContain(
        'legacy staged rows missing flattened blobStage representation'
      );
      expect(queries).toContain('DROP TABLE IF EXISTS "vfs_blob_refs"');
      expect(queries).toContain('DROP TABLE IF EXISTS "vfs_blob_staging"');
    });

    it('remains transactional and rolls back on failure', async () => {
      const pool = {
        queries: [] as string[],
        query: vi.fn().mockImplementation((sql: string) => {
          (pool as { queries: string[] }).queries.push(sql);

          if (sql.includes('DROP TABLE IF EXISTS "vfs_blob_staging"')) {
            throw new Error('forced v025 failure');
          }

          return Promise.resolve({ rows: [], rowCount: 0 });
        })
      } as unknown as Pool & { queries: string[] };

      const v025 = migrations.find((m: Migration) => m.version === 25);
      if (!v025) {
        throw new Error('v025 migration not found');
      }

      await expect(v025.up(pool)).rejects.toThrow('forced v025 failure');
      expect(pool.queries[0]).toBe('BEGIN');
      expect(pool.queries).toContain('ROLLBACK');
      expect(pool.queries).not.toContain('COMMIT');
    });
  });

  describe('v026 migration', () => {
    it('verifies canonical blob parity before dropping legacy blob table', async () => {
      const pool = createMockPool(new Map());

      const v026 = migrations.find((m: Migration) => m.version === 26);
      if (!v026) {
        throw new Error('v026 migration not found');
      }

      await v026.up(pool);

      const queries = pool.queries.join('\n');
      expect(queries).toContain(
        'legacy blob objects missing canonical blob representation'
      );
      expect(queries).toContain('DROP TABLE IF EXISTS "vfs_blob_objects"');
    });

    it('remains transactional and rolls back on failure', async () => {
      const pool = {
        queries: [] as string[],
        query: vi.fn().mockImplementation((sql: string) => {
          (pool as { queries: string[] }).queries.push(sql);

          if (sql.includes('DROP TABLE IF EXISTS "vfs_blob_objects"')) {
            throw new Error('forced v026 failure');
          }

          return Promise.resolve({ rows: [], rowCount: 0 });
        })
      } as unknown as Pool & { queries: string[] };

      const v026 = migrations.find((m: Migration) => m.version === 26);
      if (!v026) {
        throw new Error('v026 migration not found');
      }

      await expect(v026.up(pool)).rejects.toThrow('forced v026 failure');
      expect(pool.queries[0]).toBe('BEGIN');
      expect(pool.queries).toContain('ROLLBACK');
      expect(pool.queries).not.toContain('COMMIT');
    });
  });

  describe('v027 migration', () => {
    it('verifies user ACL parity before dropping legacy vfs_access', async () => {
      const pool = createMockPool(new Map());

      const v027 = migrations.find((m: Migration) => m.version === 27);
      if (!v027) {
        throw new Error('v027 migration not found');
      }

      await v027.up(pool);

      const queries = pool.queries.join('\n');
      expect(queries).toContain(
        'vfs_acl_entries missing while vfs_access still exists'
      );
      expect(queries).toContain(
        'legacy vfs_access rows missing canonical active user ACL parity'
      );
      expect(queries).toContain('DROP TABLE IF EXISTS "vfs_access"');
      expect(queries).toContain("acl.principal_type = 'user'");
      expect(queries).toContain('acl.revoked_at IS NULL');
    });

    it('remains transactional and rolls back on failure', async () => {
      const pool = {
        queries: [] as string[],
        query: vi.fn().mockImplementation((sql: string) => {
          (pool as { queries: string[] }).queries.push(sql);

          if (sql.includes('DROP TABLE IF EXISTS "vfs_access"')) {
            throw new Error('forced v027 failure');
          }

          return Promise.resolve({ rows: [], rowCount: 0 });
        })
      } as unknown as Pool & { queries: string[] };

      const v027 = migrations.find((m: Migration) => m.version === 27);
      if (!v027) {
        throw new Error('v027 migration not found');
      }

      await expect(v027.up(pool)).rejects.toThrow('forced v027 failure');
      expect(pool.queries[0]).toBe('BEGIN');
      expect(pool.queries).toContain('ROLLBACK');
      expect(pool.queries).not.toContain('COMMIT');
    });
  });

  describe('v028 migration', () => {
    it('backfills and verifies canonical ACL parity for vfs_shares', async () => {
      const pool = createMockPool(new Map());

      const v028 = migrations.find((m: Migration) => m.version === 28);
      if (!v028) {
        throw new Error('v028 migration not found');
      }

      await v028.up(pool);

      const queries = pool.queries.join('\n');
      expect(queries).toContain(
        'vfs_acl_entries missing while vfs_shares still exists'
      );
      expect(queries).toContain('INSERT INTO "vfs_acl_entries"');
      expect(queries).toContain("'share:' || s.id");
      expect(queries).toContain("WHEN 'edit' THEN 'write'");
      expect(queries).toContain(
        'vfs_shares rows missing canonical active ACL parity'
      );
    });

    it('remains transactional and rolls back on failure', async () => {
      const pool = {
        queries: [] as string[],
        query: vi.fn().mockImplementation((sql: string) => {
          (pool as { queries: string[] }).queries.push(sql);

          if (sql.includes('INSERT INTO "vfs_acl_entries"')) {
            throw new Error('forced v028 failure');
          }

          return Promise.resolve({ rows: [], rowCount: 0 });
        })
      } as unknown as Pool & { queries: string[] };

      const v028 = migrations.find((m: Migration) => m.version === 28);
      if (!v028) {
        throw new Error('v028 migration not found');
      }

      await expect(v028.up(pool)).rejects.toThrow('forced v028 failure');
      expect(pool.queries[0]).toBe('BEGIN');
      expect(pool.queries).toContain('ROLLBACK');
      expect(pool.queries).not.toContain('COMMIT');
    });
  });
});
