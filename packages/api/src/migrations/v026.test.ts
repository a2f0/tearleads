import { describe, expect, it } from 'vitest';
import { createMockPool, migrations } from './index-test-support.js';
import type { Migration } from './types.js';

describe('v026 migration', () => {
  it('emits ACL sync/CRDT changes for inserts, revokes, un-revokes, and active-row edits', async () => {
    const pool = createMockPool(new Map());

    const v026 = migrations.find((m: Migration) => m.version === 26);
    if (!v026) {
      throw new Error('v026 migration not found');
    }

    await v026.up(pool);

    const queries = pool.queries.join('\n');
    expect(queries).toContain(
      'CREATE OR REPLACE FUNCTION "vfs_acl_entries_emit_sync_crdt_trigger"'
    );
    expect(queries).toContain(
      'OLD.access_level IS DISTINCT FROM NEW.access_level'
    );
    expect(queries).toContain('OLD.expires_at IS DISTINCT FROM NEW.expires_at');
    expect(queries).toContain(
      'OLD.revoked_at IS NULL AND NEW.revoked_at IS NULL'
    );
    expect(queries).toContain(
      'OLD.revoked_at IS NULL AND NEW.revoked_at IS NOT NULL'
    );
    expect(queries).toContain(
      'OLD.revoked_at IS NOT NULL AND NEW.revoked_at IS NULL'
    );
    expect(queries).toContain(
      'CREATE TRIGGER "vfs_acl_entries_emit_sync_crdt_trigger"'
    );
  });
});
