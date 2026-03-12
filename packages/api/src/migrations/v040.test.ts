import { describe, expect, it } from 'vitest';
import { createMockPool, migrations } from './index-test-support.js';
import type { Migration } from './types.js';

describe('v040 migration', () => {
  it('migrates core VFS ID columns from text to UUID', async () => {
    const pool = createMockPool(new Map());

    const v040 = migrations.find(
      (migration: Migration) => migration.version === 40
    );
    if (!v040) {
      throw new Error('v040 migration not found');
    }

    await v040.up(pool);

    const queries = pool.queries.join('\n');
    
    expect(queries).toContain('DROP VIEW IF EXISTS "vfs_effective_visibility"');
    expect(queries).toContain('ALTER TABLE "users" ALTER COLUMN "id" TYPE UUID');
    expect(queries).toContain('ALTER TABLE "vfs_registry" ALTER COLUMN "id" TYPE UUID');
    expect(queries).toContain('ALTER TABLE "vfs_links" ALTER COLUMN "parent_id" TYPE UUID');
    expect(queries).toContain('ALTER TABLE "vfs_acl_entries" ALTER COLUMN "item_id" TYPE UUID');
    expect(queries).toContain('ALTER TABLE "vfs_sync_changes" ALTER COLUMN "item_id" TYPE UUID');
    expect(queries).toContain('ALTER TABLE "vfs_crdt_ops" ALTER COLUMN "item_id" TYPE UUID');
    expect(queries).toContain('CREATE OR REPLACE VIEW "vfs_effective_visibility"');
  });
});
