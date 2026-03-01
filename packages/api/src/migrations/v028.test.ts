import { describe, expect, it } from 'vitest';
import { createMockPool, migrations } from './index-test-support.js';
import type { Migration } from './types.js';

describe('v028 migration', () => {
  it('creates policy and ACL provenance tables with key indexes', async () => {
    const pool = createMockPool(new Map());

    const v028 = migrations.find((m: Migration) => m.version === 28);
    if (!v028) {
      throw new Error('v028 migration not found');
    }

    await v028.up(pool);

    const queries = pool.queries.join('\n');
    expect(queries).toContain(
      'CREATE TABLE IF NOT EXISTS "vfs_share_policies"'
    );
    expect(queries).toContain(
      'CREATE TABLE IF NOT EXISTS "vfs_share_policy_selectors"'
    );
    expect(queries).toContain(
      'CREATE TABLE IF NOT EXISTS "vfs_share_policy_principals"'
    );
    expect(queries).toContain(
      'CREATE TABLE IF NOT EXISTS "vfs_acl_entry_provenance"'
    );
    expect(queries).toContain(
      'CREATE UNIQUE INDEX IF NOT EXISTS "vfs_share_policy_selectors_policy_order_idx"'
    );
    expect(queries).toContain(
      'CREATE UNIQUE INDEX IF NOT EXISTS "vfs_share_policy_principals_unique_idx"'
    );
    expect(queries).toContain(
      'CREATE INDEX IF NOT EXISTS "vfs_acl_entry_provenance_source_idx"'
    );
  });
});
