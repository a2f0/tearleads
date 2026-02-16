import type { Pool } from 'pg';
import { describe, expect, it, vi } from 'vitest';
import { createMockPool, migrations } from './index-test-support.js';
import type { Migration } from './types.js';

describe('migrations (v023-v032)', () => {
  describe('v023 migration', () => {
    it('adds CRDT last write ids column and merge helper function', async () => {
      const pool = createMockPool(new Map());

      const v023 = migrations.find((m: Migration) => m.version === 23);
      if (!v023) {
        throw new Error('v023 migration not found');
      }

      await v023.up(pool);

      const queries = pool.queries.join('\n');
      expect(queries).toContain('ALTER TABLE "vfs_sync_client_state"');
      expect(queries).toContain(
        'ADD COLUMN IF NOT EXISTS "last_reconciled_write_ids"'
      );
      expect(queries).toContain(
        'CREATE OR REPLACE FUNCTION "vfs_merge_reconciled_write_ids"'
      );
      expect(queries).toContain('jsonb_object_agg');
      expect(queries).toContain('GREATEST');
    });

    it('remains transactional and rolls back on failure', async () => {
      const pool = {
        queries: [] as string[],
        query: vi.fn().mockImplementation((sql: string) => {
          (pool as { queries: string[] }).queries.push(sql);

          if (sql.includes('CREATE OR REPLACE FUNCTION')) {
            throw new Error('forced v023 failure');
          }

          return Promise.resolve({ rows: [], rowCount: 0 });
        })
      } as unknown as Pool & { queries: string[] };

      const v023 = migrations.find((m: Migration) => m.version === 23);
      if (!v023) {
        throw new Error('v023 migration not found');
      }

      await expect(v023.up(pool)).rejects.toThrow('forced v023 failure');
      expect(pool.queries[0]).toBe('BEGIN');
      expect(pool.queries).toContain('ROLLBACK');
      expect(pool.queries).not.toContain('COMMIT');
    });
  });

  describe('v024 migration', () => {
    it('backfills legacy blob staging rows into flattened VFS structures', async () => {
      const pool = createMockPool(new Map());

      const v024 = migrations.find((m: Migration) => m.version === 24);
      if (!v024) {
        throw new Error('v024 migration not found');
      }

      await v024.up(pool);

      const queries = pool.queries.join('\n');
      expect(queries).toContain(
        'blob object id collides with non-blob vfs_registry row'
      );
      expect(queries).toContain('INSERT INTO "vfs_registry" (');
      expect(queries).toContain("'blobStage'");
      expect(queries).toContain('INSERT INTO "vfs_links" (');
      expect(queries).toContain("'blob-stage:staged'");
      expect(queries).toContain("'blob-stage:attached'");
      expect(queries).toContain("'blob-stage:abandoned'");
      expect(queries).toContain("'attachedItemId'");
    });

    it('remains transactional and rolls back on failure', async () => {
      const pool = {
        queries: [] as string[],
        query: vi.fn().mockImplementation((sql: string) => {
          (pool as { queries: string[] }).queries.push(sql);

          if (sql.includes('INSERT INTO "vfs_links"')) {
            throw new Error('forced v024 failure');
          }

          return Promise.resolve({ rows: [], rowCount: 0 });
        })
      } as unknown as Pool & { queries: string[] };

      const v024 = migrations.find((m: Migration) => m.version === 24);
      if (!v024) {
        throw new Error('v024 migration not found');
      }

      await expect(v024.up(pool)).rejects.toThrow('forced v024 failure');
      expect(pool.queries[0]).toBe('BEGIN');
      expect(pool.queries).toContain('ROLLBACK');
      expect(pool.queries).not.toContain('COMMIT');
    });
  });

  describe('v025 migration', () => {
    it('verifies flattened backfill parity before dropping legacy blob tables', async () => {
      const pool = createMockPool(new Map());

      const v025 = migrations.find((m: Migration) => m.version === 25);
      if (!v025) {
        throw new Error('v025 migration not found');
      }

      await v025.up(pool);

      const queries = pool.queries.join('\n');
      expect(queries).toContain(
        'legacy staged rows missing flattened blobStage representation'
      );
      expect(queries).toContain('DROP TABLE IF EXISTS "vfs_blob_refs"');
      expect(queries).toContain('DROP TABLE IF EXISTS "vfs_blob_staging"');
    });

    it('remains transactional and rolls back on failure', async () => {
      const pool = {
        queries: [] as string[],
        query: vi.fn().mockImplementation((sql: string) => {
          (pool as { queries: string[] }).queries.push(sql);

          if (sql.includes('DROP TABLE IF EXISTS "vfs_blob_staging"')) {
            throw new Error('forced v025 failure');
          }

          return Promise.resolve({ rows: [], rowCount: 0 });
        })
      } as unknown as Pool & { queries: string[] };

      const v025 = migrations.find((m: Migration) => m.version === 25);
      if (!v025) {
        throw new Error('v025 migration not found');
      }

      await expect(v025.up(pool)).rejects.toThrow('forced v025 failure');
      expect(pool.queries[0]).toBe('BEGIN');
      expect(pool.queries).toContain('ROLLBACK');
      expect(pool.queries).not.toContain('COMMIT');
    });
  });

  describe('v026 migration', () => {
    it('verifies canonical blob parity before dropping legacy blob table', async () => {
      const pool = createMockPool(new Map());

      const v026 = migrations.find((m: Migration) => m.version === 26);
      if (!v026) {
        throw new Error('v026 migration not found');
      }

      await v026.up(pool);

      const queries = pool.queries.join('\n');
      expect(queries).toContain(
        'legacy blob objects missing canonical blob representation'
      );
      expect(queries).toContain('DROP TABLE IF EXISTS "vfs_blob_objects"');
    });

    it('remains transactional and rolls back on failure', async () => {
      const pool = {
        queries: [] as string[],
        query: vi.fn().mockImplementation((sql: string) => {
          (pool as { queries: string[] }).queries.push(sql);

          if (sql.includes('DROP TABLE IF EXISTS "vfs_blob_objects"')) {
            throw new Error('forced v026 failure');
          }

          return Promise.resolve({ rows: [], rowCount: 0 });
        })
      } as unknown as Pool & { queries: string[] };

      const v026 = migrations.find((m: Migration) => m.version === 26);
      if (!v026) {
        throw new Error('v026 migration not found');
      }

      await expect(v026.up(pool)).rejects.toThrow('forced v026 failure');
      expect(pool.queries[0]).toBe('BEGIN');
      expect(pool.queries).toContain('ROLLBACK');
      expect(pool.queries).not.toContain('COMMIT');
    });
  });

  describe('v027 migration', () => {
    it('verifies user ACL parity before dropping legacy vfs_access', async () => {
      const pool = createMockPool(new Map());

      const v027 = migrations.find((m: Migration) => m.version === 27);
      if (!v027) {
        throw new Error('v027 migration not found');
      }

      await v027.up(pool);

      const queries = pool.queries.join('\n');
      expect(queries).toContain(
        'vfs_acl_entries missing while vfs_access still exists'
      );
      expect(queries).toContain(
        'legacy vfs_access rows missing canonical active user ACL parity'
      );
      expect(queries).toContain('DROP TABLE IF EXISTS "vfs_access"');
      expect(queries).toContain("acl.principal_type = 'user'");
      expect(queries).toContain('acl.revoked_at IS NULL');
    });

    it('remains transactional and rolls back on failure', async () => {
      const pool = {
        queries: [] as string[],
        query: vi.fn().mockImplementation((sql: string) => {
          (pool as { queries: string[] }).queries.push(sql);

          if (sql.includes('DROP TABLE IF EXISTS "vfs_access"')) {
            throw new Error('forced v027 failure');
          }

          return Promise.resolve({ rows: [], rowCount: 0 });
        })
      } as unknown as Pool & { queries: string[] };

      const v027 = migrations.find((m: Migration) => m.version === 27);
      if (!v027) {
        throw new Error('v027 migration not found');
      }

      await expect(v027.up(pool)).rejects.toThrow('forced v027 failure');
      expect(pool.queries[0]).toBe('BEGIN');
      expect(pool.queries).toContain('ROLLBACK');
      expect(pool.queries).not.toContain('COMMIT');
    });
  });

  describe('v028 migration', () => {
    it('backfills and verifies canonical ACL parity for vfs_shares', async () => {
      const pool = createMockPool(new Map());

      const v028 = migrations.find((m: Migration) => m.version === 28);
      if (!v028) {
        throw new Error('v028 migration not found');
      }

      await v028.up(pool);

      const queries = pool.queries.join('\n');
      expect(queries).toContain(
        'vfs_acl_entries missing while vfs_shares still exists'
      );
      expect(queries).toContain('INSERT INTO "vfs_acl_entries"');
      expect(queries).toContain("'share:' || s.id");
      expect(queries).toContain("WHEN 'edit' THEN 'write'");
      expect(queries).toContain(
        'vfs_shares rows missing canonical active ACL parity'
      );
    });

    it('remains transactional and rolls back on failure', async () => {
      const pool = {
        queries: [] as string[],
        query: vi.fn().mockImplementation((sql: string) => {
          (pool as { queries: string[] }).queries.push(sql);

          if (sql.includes('INSERT INTO "vfs_acl_entries"')) {
            throw new Error('forced v028 failure');
          }

          return Promise.resolve({ rows: [], rowCount: 0 });
        })
      } as unknown as Pool & { queries: string[] };

      const v028 = migrations.find((m: Migration) => m.version === 28);
      if (!v028) {
        throw new Error('v028 migration not found');
      }

      await expect(v028.up(pool)).rejects.toThrow('forced v028 failure');
      expect(pool.queries[0]).toBe('BEGIN');
      expect(pool.queries).toContain('ROLLBACK');
      expect(pool.queries).not.toContain('COMMIT');
    });
  });

  describe('v029 migration', () => {
    it('backfills and verifies canonical ACL parity for org_shares', async () => {
      const pool = createMockPool(new Map());

      const v029 = migrations.find((m: Migration) => m.version === 29);
      if (!v029) {
        throw new Error('v029 migration not found');
      }

      await v029.up(pool);

      const queries = pool.queries.join('\n');
      expect(queries).toContain(
        'vfs_acl_entries missing while org_shares still exists'
      );
      expect(queries).toContain('INSERT INTO "vfs_acl_entries"');
      expect(queries).toContain("'org-share:' || os.id");
      expect(queries).toContain("WHEN 'edit' THEN 'write'");
      expect(queries).toContain(
        'org_shares rows missing canonical active ACL parity'
      );
    });

    it('remains transactional and rolls back on failure', async () => {
      const pool = {
        queries: [] as string[],
        query: vi.fn().mockImplementation((sql: string) => {
          (pool as { queries: string[] }).queries.push(sql);

          if (sql.includes('INSERT INTO "vfs_acl_entries"')) {
            throw new Error('forced v029 failure');
          }

          return Promise.resolve({ rows: [], rowCount: 0 });
        })
      } as unknown as Pool & { queries: string[] };

      const v029 = migrations.find((m: Migration) => m.version === 29);
      if (!v029) {
        throw new Error('v029 migration not found');
      }

      await expect(v029.up(pool)).rejects.toThrow('forced v029 failure');
      expect(pool.queries[0]).toBe('BEGIN');
      expect(pool.queries).toContain('ROLLBACK');
      expect(pool.queries).not.toContain('COMMIT');
    });
  });

  describe('v030 migration', () => {
    it('backfills and verifies canonical folder metadata parity', async () => {
      const pool = createMockPool(new Map());

      const v030 = migrations.find((m: Migration) => m.version === 30);
      if (!v030) {
        throw new Error('v030 migration not found');
      }

      await v030.up(pool);

      const queries = pool.queries.join('\n');
      expect(queries).toContain(
        'vfs_registry missing while vfs_folders still exists'
      );
      expect(queries).toContain('ALTER TABLE "vfs_registry"');
      expect(queries).toContain('ADD COLUMN IF NOT EXISTS "encrypted_name"');
      expect(queries).toContain('ADD COLUMN IF NOT EXISTS "sort_direction"');
      expect(queries).toContain(
        'vfs_folders rows missing canonical folder registry identities'
      );
      expect(queries).toContain('UPDATE "vfs_registry" r');
      expect(queries).toContain(
        'r.encrypted_name IS DISTINCT FROM f.encrypted_name'
      );
      expect(queries).toContain(
        'vfs_folders rows missing canonical folder metadata parity'
      );
    });

    it('remains transactional and rolls back on failure', async () => {
      const pool = {
        queries: [] as string[],
        query: vi.fn().mockImplementation((sql: string) => {
          (pool as { queries: string[] }).queries.push(sql);

          if (sql.includes('UPDATE "vfs_registry" r')) {
            throw new Error('forced v030 failure');
          }

          return Promise.resolve({ rows: [], rowCount: 0 });
        })
      } as unknown as Pool & { queries: string[] };

      const v030 = migrations.find((m: Migration) => m.version === 30);
      if (!v030) {
        throw new Error('v030 migration not found');
      }

      await expect(v030.up(pool)).rejects.toThrow('forced v030 failure');
      expect(pool.queries[0]).toBe('BEGIN');
      expect(pool.queries).toContain('ROLLBACK');
      expect(pool.queries).not.toContain('COMMIT');
    });
  });

  describe('v031 migration', () => {
    it('verifies canonical/legacy folder retirement preconditions', async () => {
      const pool = createMockPool(new Map());

      const v031 = migrations.find((m: Migration) => m.version === 31);
      if (!v031) {
        throw new Error('v031 migration not found');
      }

      await v031.up(pool);

      const queries = pool.queries.join('\n');
      expect(queries).toContain(
        'vfs_registry missing while vfs_folders still exists'
      );
      expect(queries).toContain(
        'vfs_folders rows missing canonical folder registry identities'
      );
      expect(queries).toContain(
        'canonical folder rows missing legacy vfs_folders rows'
      );
      expect(queries).toContain(
        'vfs_folders rows missing canonical folder metadata parity'
      );
    });

    it('remains transactional and rolls back on failure', async () => {
      const pool = {
        queries: [] as string[],
        query: vi.fn().mockImplementation((sql: string) => {
          (pool as { queries: string[] }).queries.push(sql);

          if (
            sql.includes(
              'canonical folder rows missing legacy vfs_folders rows'
            )
          ) {
            throw new Error('forced v031 failure');
          }

          return Promise.resolve({ rows: [], rowCount: 0 });
        })
      } as unknown as Pool & { queries: string[] };

      const v031 = migrations.find((m: Migration) => m.version === 31);
      if (!v031) {
        throw new Error('v031 migration not found');
      }

      await expect(v031.up(pool)).rejects.toThrow('forced v031 failure');
      expect(pool.queries[0]).toBe('BEGIN');
      expect(pool.queries).toContain('ROLLBACK');
      expect(pool.queries).not.toContain('COMMIT');
    });
  });

  describe('v032 migration', () => {
    it('records folder retirement checkpoint only after parity checks pass', async () => {
      const pool = createMockPool(new Map());

      const v032 = migrations.find((m: Migration) => m.version === 32);
      if (!v032) {
        throw new Error('v032 migration not found');
      }

      await v032.up(pool);

      const queries = pool.queries.join('\n');
      expect(queries).toContain(
        'vfs_registry missing before folder retirement checkpoint'
      );
      expect(queries).toContain(
        'vfs_folders missing before folder retirement checkpoint'
      );
      expect(queries).toContain('folder retirement counts diverged');
      expect(queries).toContain('folder retirement metadata mismatches remain');
      expect(queries).toContain(
        'CREATE TABLE IF NOT EXISTS "vfs_folder_retirement_checkpoints"'
      );
      expect(queries).toContain(
        'INSERT INTO "vfs_folder_retirement_checkpoints"'
      );
    });

    it('remains transactional and rolls back on failure', async () => {
      const pool = {
        queries: [] as string[],
        query: vi.fn().mockImplementation((sql: string) => {
          (pool as { queries: string[] }).queries.push(sql);

          if (sql.includes('INSERT INTO "vfs_folder_retirement_checkpoints"')) {
            throw new Error('forced v032 failure');
          }

          return Promise.resolve({ rows: [], rowCount: 0 });
        })
      } as unknown as Pool & { queries: string[] };

      const v032 = migrations.find((m: Migration) => m.version === 32);
      if (!v032) {
        throw new Error('v032 migration not found');
      }

      await expect(v032.up(pool)).rejects.toThrow('forced v032 failure');
      expect(pool.queries[0]).toBe('BEGIN');
      expect(pool.queries).toContain('ROLLBACK');
      expect(pool.queries).not.toContain('COMMIT');
    });
  });
});
