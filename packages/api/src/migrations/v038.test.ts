import { describe, expect, it } from 'vitest';
import { createMockPool, migrations } from './index-test-support.js';
import type { Migration } from './types.js';

describe('v038 migration', () => {
  it('materializes vfs_effective_visibility into a table with triggers', async () => {
    const pool = createMockPool(new Map());

    const v038 = migrations.find(
      (migration: Migration) => migration.version === 38
    );
    if (!v038) {
      throw new Error('v038 migration not found');
    }

    await v038.up(pool);

    const queries = pool.queries.join('\n');
    
    // Check table and index creation
    expect(queries).toContain('CREATE TABLE "vfs_effective_visibility_mat"');
    expect(queries).toContain('CREATE INDEX "idx_vfs_visibility_user_item"');
    expect(queries).toContain('CREATE INDEX "idx_vfs_visibility_item"');
    
    // Check refresh functions
    expect(queries).toContain('CREATE OR REPLACE FUNCTION "vfs_refresh_visibility_for_item"');
    expect(queries).toContain('CREATE OR REPLACE FUNCTION "vfs_refresh_visibility_for_user"');
    
    // Check triggers
    expect(queries).toContain('CREATE TRIGGER "tg_refresh_visibility_registry"');
    expect(queries).toContain('CREATE TRIGGER "tg_refresh_visibility_acl"');
    expect(queries).toContain('CREATE TRIGGER "tg_refresh_visibility_groups"');
    expect(queries).toContain('CREATE TRIGGER "tg_refresh_visibility_orgs"');
    
    // Check initial population and view update
    expect(queries).toContain('INSERT INTO "vfs_effective_visibility_mat"');
    expect(queries).toContain('CREATE OR REPLACE VIEW "vfs_effective_visibility"');
    expect(queries).toContain('FROM "vfs_effective_visibility_mat"');
  });
});
