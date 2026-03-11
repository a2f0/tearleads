import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createMockPool, migrations } from './index-test-support.js';
import type { Migration } from './types.js';

describe('v036 migration', () => {
  let pool: ReturnType<typeof createMockPool>;

  function getV036Migration(): Migration {
    const v036 = migrations.find(
      (migration: Migration) => migration.version === 36
    );
    if (!v036) {
      throw new Error('v036 migration not found');
    }
    return v036;
  }

  beforeEach(() => {
    getV036Migration();
    pool = createMockPool(new Map());
  });

  it('backfills and enforces required organization_id on vfs_registry', async () => {
    const v036 = getV036Migration();
    await v036.up(pool);

    const queries = pool.queries.join('\n');
    expect(queries).toContain('ALTER TABLE "vfs_registry"');
    expect(queries).toContain(
      'ADD COLUMN IF NOT EXISTS "organization_id" TEXT'
    );
    expect(queries).toContain(
      'SET "organization_id" = users.personal_organization_id'
    );
    expect(queries).toContain('FROM "mls_messages" AS messages');
    expect(queries).toContain('FROM vfs_acl_entries');
    expect(queries).toContain('ALTER COLUMN "organization_id" SET NOT NULL');
    expect(queries).toContain(
      'CREATE INDEX IF NOT EXISTS "vfs_registry_org_idx"'
    );
  });

  it('fails when unscoped rows remain after backfill', async () => {
    const v036 = getV036Migration();
    vi.spyOn(pool, 'query').mockImplementation((sql: string) => {
      pool.queries.push(sql);
      if (sql.includes('COUNT(*)::text AS count')) {
        return Promise.resolve({ rows: [{ count: '2' }], rowCount: 1 });
      }

      return Promise.resolve({ rows: [], rowCount: 0 });
    });

    await expect(v036.up(pool)).rejects.toThrow(
      /Unable to backfill organization_id for 2 vfs_registry rows/u
    );
    expect(pool.queries.join('\n')).toContain('ROLLBACK');
  });
});
