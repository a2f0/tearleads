import { describe, expect, it } from 'vitest';
import { createMockPool, migrations } from './index-test-support.js';
import type { Migration } from './types.js';

describe('v031 migration', () => {
  it('creates direct-provenance lookup index for ACL guards', async () => {
    const pool = createMockPool(new Map());

    const v031 = migrations.find(
      (migration: Migration) => migration.version === 31
    );
    if (!v031) {
      throw new Error('v031 migration not found');
    }

    await v031.up(pool);

    const queries = pool.queries.join('\n');
    expect(queries).toContain(
      'CREATE INDEX IF NOT EXISTS "vfs_acl_entry_provenance_acl_type_idx"'
    );
    expect(queries).toContain(
      'ON "vfs_acl_entry_provenance" ("acl_entry_id", "provenance_type")'
    );
  });
});
