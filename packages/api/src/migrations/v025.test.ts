import { describe, expect, it } from 'vitest';
import { createMockPool, migrations } from './index-test-support.js';
import type { Migration } from './types.js';

describe('v025 migration', () => {
  it('adds composite CRDT feed ordering index', async () => {
    const pool = createMockPool(new Map());

    const v025 = migrations.find((m: Migration) => m.version === 25);
    if (!v025) {
      throw new Error('v025 migration not found');
    }

    await v025.up(pool);

    const queries = pool.queries.join('\n');
    expect(queries).toContain(
      'CREATE INDEX IF NOT EXISTS "vfs_crdt_ops_occurred_id_idx"'
    );
    expect(queries).toContain('ON "vfs_crdt_ops" ("occurred_at", "id")');
  });
});
