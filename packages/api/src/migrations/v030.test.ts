import { describe, expect, it } from 'vitest';
import { createMockPool, migrations } from './index-test-support.js';
import type { Migration } from './types.js';

describe('v030 migration', () => {
  it('creates vfs_effective_visibility view from canonical ownership+acl data', async () => {
    const pool = createMockPool(new Map());

    const v030 = migrations.find(
      (migration: Migration) => migration.version === 30
    );
    if (!v030) {
      throw new Error('v030 migration not found');
    }

    await v030.up(pool);

    const queries = pool.queries.join('\n');
    expect(queries).toContain(
      'CREATE OR REPLACE VIEW "vfs_effective_visibility"'
    );
    expect(queries).toContain('FROM vfs_registry registry');
    expect(queries).toContain('FROM vfs_acl_entries entry');
    expect(queries).toContain('FROM user_groups');
    expect(queries).toContain('FROM user_organizations');
  });
});
