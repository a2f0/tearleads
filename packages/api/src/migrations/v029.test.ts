import { describe, expect, it } from 'vitest';
import { createMockPool, migrations } from './index-test-support.js';
import type { Migration } from './types.js';

describe('v029 migration', () => {
  it('creates CRDT snapshot table and supporting index', async () => {
    const pool = createMockPool(new Map());

    const v029 = migrations.find((migration: Migration) => migration.version === 29);
    if (!v029) {
      throw new Error('v029 migration not found');
    }

    await v029.up(pool);

    const queries = pool.queries.join('\n');
    expect(queries).toContain('CREATE TABLE IF NOT EXISTS "vfs_crdt_snapshots"');
    expect(queries).toContain('"snapshot_payload" JSONB NOT NULL');
    expect(queries).toContain(
      'CONSTRAINT "vfs_crdt_snapshots_cursor_pair_check"'
    );
    expect(queries).toContain(
      'CREATE INDEX IF NOT EXISTS "vfs_crdt_snapshots_updated_idx"'
    );
  });
});
