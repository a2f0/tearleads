import type { Pool } from 'pg';
import { describe, expect, it, vi } from 'vitest';
import { getCurrentVersion, runMigrations } from './index.js';
import { createMockPool, migrations } from './index-test-support.js';
import type { Migration } from './types.js';

describe('migrations (core through v004)', () => {
  describe('getCurrentVersion', () => {
    it('returns 0 when table does not exist', async () => {
      const pool = createMockPool(new Map());
      vi.spyOn(pool, 'query').mockRejectedValueOnce(
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
    it('starts at v001 and stays sequential', () => {
      const versions = migrations.map(
        (migration: Migration) => migration.version
      );

      expect(versions).toEqual([1, 2, 3, 4]);
      expect(migrations[0]?.version).toBe(1);
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
    it('applies all migrations on a fresh database', async () => {
      let versionCallCount = 0;
      const pool = {
        queries: [] as string[],
        query: vi.fn().mockImplementation((sql: string) => {
          pool.queries.push(sql);

          if (sql.includes('MAX(version)')) {
            versionCallCount += 1;
            return Promise.resolve({
            rows: [{ version: versionCallCount === 1 ? null : 4 }],
            rowCount: 1
          });
        }

          return Promise.resolve({ rows: [], rowCount: 0 });
        })
      } as unknown as Pool & { queries: string[] };

      const result = await runMigrations(pool);

      expect(result.applied).toEqual([1, 2, 3, 4]);
      expect(result.currentVersion).toBe(4);
      expect(
        pool.queries.filter((query) =>
          query.includes('INSERT INTO schema_migrations')
        )
      ).toHaveLength(4);
    });

    it('skips already applied migrations', async () => {
      const pool = createMockPool(
        new Map([['MAX(version)', { rows: [{ version: 4 }], rowCount: 1 }]])
      );

      const result = await runMigrations(pool);

      expect(result.applied).toEqual([]);
      expect(result.currentVersion).toBe(4);
    });

    it('applies pending migrations when behind', async () => {
      let versionCallCount = 0;
      const pool = createMockPool(new Map());
      vi.spyOn(pool, 'query').mockImplementation((sql: string) => {
        pool.queries.push(sql);

        if (sql.includes('MAX(version)')) {
          versionCallCount += 1;
          return Promise.resolve({
            rows: [{ version: versionCallCount === 1 ? 1 : 4 }],
            rowCount: 1
          });
        }

        return Promise.resolve({ rows: [], rowCount: 0 });
      });

      const result = await runMigrations(pool);

      expect(result.applied).toEqual([2, 3, 4]);
      expect(result.currentVersion).toBe(4);
    });
  });

  describe('v001 migration', () => {
    it('creates foundational identity and vfs tables', async () => {
      const pool = createMockPool(new Map());

      const v001 = migrations.find(
        (migration: Migration) => migration.version === 1
      );
      if (!v001) {
        throw new Error('v001 migration not found');
      }

      await v001.up(pool);

      const queries = pool.queries.join('\n');

      expect(queries).toContain(
        'CREATE TABLE IF NOT EXISTS "schema_migrations"'
      );
      expect(queries).toContain('CREATE TABLE "users"');
      expect(queries).toContain('CREATE TABLE "user_credentials"');
      expect(queries).toContain('CREATE TABLE "organizations"');
      expect(queries).toContain('CREATE TABLE "vfs_registry"');
      expect(queries).toContain('CREATE TABLE "vfs_links"');
      expect(queries).toContain('CREATE TABLE "vfs_acl_entries"');
      expect(queries).toContain('CREATE TABLE "vfs_item_state"');
      expect(queries).toContain('CREATE TABLE "vfs_sync_changes"');
      expect(queries).toContain('CREATE TABLE "vfs_crdt_ops"');
      expect(queries).toContain('CREATE INDEX "vfs_crdt_ops_item_idx"');
      expect(queries).toContain('CREATE INDEX "vfs_crdt_ops_root_scope_idx"');
      expect(queries).toContain('CREATE TABLE "vfs_sync_client_state"');
    });

    it('creates core sync/crdt functions and triggers', async () => {
      const pool = createMockPool(new Map());

      const v001 = migrations.find(
        (migration: Migration) => migration.version === 1
      );
      if (!v001) {
        throw new Error('v001 migration not found');
      }

      await v001.up(pool);

      const queries = pool.queries.join('\n');

      expect(queries).toContain(
        'CREATE OR REPLACE FUNCTION "vfs_merge_reconciled_write_ids"'
      );
      expect(queries).toContain(
        'CREATE OR REPLACE FUNCTION "vfs_emit_sync_change"'
      );
      expect(queries).toContain('CREATE TRIGGER "tg_vfs_registry_sync"');
      expect(queries).toContain('CREATE TRIGGER "tg_vfs_links_sync"');
      expect(queries).toContain('CREATE TRIGGER "tg_vfs_acl_entries_sync"');
    });

    it('uses uuid/json/timestamp postgres types', async () => {
      const pool = createMockPool(new Map());

      const v001 = migrations.find(
        (migration: Migration) => migration.version === 1
      );
      if (!v001) {
        throw new Error('v001 migration not found');
      }

      await v001.up(pool);

      const queries = pool.queries.join('\n');

      expect(queries).toContain('UUID');
      expect(queries).toContain('TIMESTAMPTZ');
      expect(queries).toContain('JSONB');
    });
  });

  describe('v002 migration', () => {
    it('creates materialized visibility structures and triggers', async () => {
      const pool = createMockPool(new Map());

      const v002 = migrations.find(
        (migration: Migration) => migration.version === 2
      );
      if (!v002) {
        throw new Error('v002 migration not found');
      }

      await v002.up(pool);

      const queries = pool.queries.join('\n');

      expect(queries).toContain('CREATE TABLE "vfs_effective_visibility_mat"');
      expect(queries).toContain('CREATE INDEX "idx_vfs_visibility_user_item"');
      expect(queries).toContain(
        'CREATE OR REPLACE FUNCTION "vfs_refresh_visibility_for_item"'
      );
      expect(queries).toContain(
        'CREATE OR REPLACE FUNCTION "vfs_refresh_visibility_for_user"'
      );
      expect(queries).toContain(
        'CREATE TRIGGER "tg_refresh_visibility_registry"'
      );
      expect(queries).toContain('CREATE TRIGGER "tg_refresh_visibility_acl"');
      expect(queries).toContain(
        'CREATE OR REPLACE VIEW "vfs_effective_visibility"'
      );
    });
  });

  describe('v003 migration', () => {
    it('creates domain data tables and indexes', async () => {
      const pool = createMockPool(new Map());

      const v003 = migrations.find(
        (migration: Migration) => migration.version === 3
      );
      if (!v003) {
        throw new Error('v003 migration not found');
      }

      await v003.up(pool);

      const queries = pool.queries.join('\n');

      expect(queries).toContain('CREATE TABLE "notes"');
      expect(queries).toContain('CREATE TABLE "files"');
      expect(queries).toContain('CREATE TABLE "contacts"');
      expect(queries).toContain('CREATE TABLE "emails"');
      expect(queries).toContain('CREATE INDEX "emails_received_at_idx"');
      expect(queries).toContain('CREATE TABLE "ai_conversations"');
      expect(queries).toContain('CREATE TABLE "mls_groups"');
      expect(queries).toContain('CREATE TABLE "organization_billing_accounts"');
      expect(queries).toContain('CREATE TABLE "analytics_events"');
    });
  });

  describe('v004 migration', () => {
    it('converts MLS base64 text payload columns to bytea', async () => {
      const pool = createMockPool(new Map());

      const v004 = migrations.find(
        (migration: Migration) => migration.version === 4
      );
      if (!v004) {
        throw new Error('v004 migration not found');
      }

      await v004.up(pool);

      const queries = pool.queries.join('\n');

      expect(queries).toContain(
        'ALTER COLUMN "key_package_data" TYPE BYTEA'
      );
      expect(queries).toContain('ALTER COLUMN "welcome_data" TYPE BYTEA');
      expect(queries).toContain('ALTER COLUMN "encrypted_state" TYPE BYTEA');
    });
  });
});
