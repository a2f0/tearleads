import { describe, expect, it } from 'vitest';
import { createMockPool, migrations } from './index-test-support.js';
import type { Migration } from './types.js';

describe('v030 migration', () => {
  it('creates an index for MLS message sequence lookup', async () => {
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
      'CREATE INDEX IF NOT EXISTS "vfs_crdt_ops_mls_group_seq_idx"'
    );
    expect(queries).toContain(
      `AND "source_table" IN ('mls_messages', 'mls_message')`
    );
    expect(queries).toContain(`split_part("source_id", ':', 2)`);
  });
});
