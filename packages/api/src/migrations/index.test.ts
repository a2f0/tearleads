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
        new Map([['MAX(version)', { rows: [{ version: 4 }], rowCount: 1 }]])
      );

      const result = await runMigrations(pool);

      // No new migrations should be applied
      expect(result.applied).toEqual([]);
      expect(result.currentVersion).toBe(4);
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
          return Promise.resolve({ rows: [{ version: 4 }], rowCount: 1 });
        }

        return Promise.resolve({ rows: [], rowCount: 0 });
      });

      const result = await runMigrations(pool);

      expect(result.applied).toEqual([2, 3, 4]);
      expect(result.currentVersion).toBe(4);
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
});
