import { describe, expect, it } from 'vitest';
import { createMockPool, migrations } from './index-test-support.js';
import type { Migration } from './types.js';

describe('v033 migration', () => {
  it('creates CRDT replica head table, index, and backfill', async () => {
    const pool = createMockPool(new Map());

    const v033 = migrations.find(
      (migration: Migration) => migration.version === 33
    );
    if (!v033) {
      throw new Error('v033 migration not found');
    }

    await v033.up(pool);

    const queries = pool.queries.join('\n');
    expect(queries).toContain('CREATE TABLE IF NOT EXISTS "vfs_crdt_replica_heads"');
    expect(queries).toContain(
      'vfs_crdt_replica_heads_max_write_positive_check'
    );
    expect(queries).toContain(
      'CREATE INDEX IF NOT EXISTS "vfs_crdt_replica_heads_updated_idx"'
    );
    expect(queries).toContain('INSERT INTO vfs_crdt_replica_heads');
    expect(queries).toContain('FROM vfs_crdt_ops ops');
    expect(queries).toContain("ops.source_table = 'vfs_crdt_client_push'");
    expect(queries).toContain('ON CONFLICT (actor_id, replica_id) DO UPDATE SET');
  });
});
