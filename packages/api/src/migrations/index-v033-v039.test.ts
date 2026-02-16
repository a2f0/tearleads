import type { Pool } from 'pg';
import { describe, expect, it, vi } from 'vitest';
import { createMockPool, migrations } from './index-test-support.js';
import type { Migration } from './types.js';

describe('migrations (v033-v039)', () => {
  describe('v033 migration', () => {
    it('drops vfs_folders only after retirement checkpoint guardrails', async () => {
      const pool = createMockPool(new Map());

      const v033 = migrations.find((m: Migration) => m.version === 33);
      if (!v033) {
        throw new Error('v033 migration not found');
      }

      await v033.up(pool);

      const queries = pool.queries.join('\n');
      expect(queries).toContain('vfs_registry missing before vfs_folders drop');
      expect(queries).toContain(
        'retirement checkpoints missing before vfs_folders drop'
      );
      expect(queries).toContain(
        'no retirement checkpoint rows recorded before vfs_folders drop'
      );
      expect(queries).toContain(
        'vfs_folders metadata parity check failed at drop time'
      );
      expect(queries).toContain('DROP TABLE "vfs_folders"');
    });

    it('remains transactional and rolls back on failure', async () => {
      const pool = {
        queries: [] as string[],
        query: vi.fn().mockImplementation((sql: string) => {
          (pool as { queries: string[] }).queries.push(sql);

          if (sql.includes('DROP TABLE "vfs_folders"')) {
            throw new Error('forced v033 failure');
          }

          return Promise.resolve({ rows: [], rowCount: 0 });
        })
      } as unknown as Pool & { queries: string[] };

      const v033 = migrations.find((m: Migration) => m.version === 33);
      if (!v033) {
        throw new Error('v033 migration not found');
      }

      await expect(v033.up(pool)).rejects.toThrow('forced v033 failure');
      expect(pool.queries[0]).toBe('BEGIN');
      expect(pool.queries).toContain('ROLLBACK');
      expect(pool.queries).not.toContain('COMMIT');
    });
  });

  describe('v034 migration', () => {
    it('drops retirement checkpoints only after guarded folder retirement', async () => {
      const pool = createMockPool(new Map());

      const v034 = migrations.find((m: Migration) => m.version === 34);
      if (!v034) {
        throw new Error('v034 migration not found');
      }

      await v034.up(pool);

      const queries = pool.queries.join('\n');
      expect(queries).toContain(
        'vfs_registry missing during folder retirement finalization'
      );
      expect(queries).toContain(
        'retirement checkpoints missing during folder retirement finalization'
      );
      expect(queries).toContain(
        'vfs_folders still exists before folder retirement finalization'
      );
      expect(queries).toContain(
        'no retirement checkpoint rows recorded before folder retirement finalization'
      );
      expect(queries).toContain(
        'DROP TABLE "vfs_folder_retirement_checkpoints"'
      );
    });

    it('remains transactional and rolls back on failure', async () => {
      const pool = {
        queries: [] as string[],
        query: vi.fn().mockImplementation((sql: string) => {
          (pool as { queries: string[] }).queries.push(sql);

          if (sql.includes('DROP TABLE "vfs_folder_retirement_checkpoints"')) {
            throw new Error('forced v034 failure');
          }

          return Promise.resolve({ rows: [], rowCount: 0 });
        })
      } as unknown as Pool & { queries: string[] };

      const v034 = migrations.find((m: Migration) => m.version === 34);
      if (!v034) {
        throw new Error('v034 migration not found');
      }

      await expect(v034.up(pool)).rejects.toThrow('forced v034 failure');
      expect(pool.queries[0]).toBe('BEGIN');
      expect(pool.queries).toContain('ROLLBACK');
      expect(pool.queries).not.toContain('COMMIT');
    });
  });

  describe('v035 migration', () => {
    it('records share retirement checkpoints only after parity guardrails pass', async () => {
      const pool = createMockPool(new Map());

      const v035 = migrations.find((m: Migration) => m.version === 35);
      if (!v035) {
        throw new Error('v035 migration not found');
      }

      await v035.up(pool);

      const queries = pool.queries.join('\n');
      expect(queries).toContain(
        'vfs_acl_entries missing before share retirement checkpoint'
      );
      expect(queries).toContain(
        'vfs_shares missing before share retirement checkpoint'
      );
      expect(queries).toContain(
        'org_shares missing before share retirement checkpoint'
      );
      expect(queries).toContain(
        'vfs_shares active ACL parity mismatches remain'
      );
      expect(queries).toContain(
        'org_shares active ACL parity mismatches remain'
      );
      expect(queries).toContain(
        'share-sourced ACL rows are orphaned from vfs_shares'
      );
      expect(queries).toContain(
        'org-share-sourced ACL rows are orphaned from org_shares'
      );
      expect(queries).toContain(
        'CREATE TABLE IF NOT EXISTS "vfs_share_retirement_checkpoints"'
      );
      expect(queries).toContain(
        'INSERT INTO "vfs_share_retirement_checkpoints"'
      );
    });

    it('remains transactional and rolls back on failure', async () => {
      const pool = {
        queries: [] as string[],
        query: vi.fn().mockImplementation((sql: string) => {
          (pool as { queries: string[] }).queries.push(sql);

          if (sql.includes('INSERT INTO "vfs_share_retirement_checkpoints"')) {
            throw new Error('forced v035 failure');
          }

          return Promise.resolve({ rows: [], rowCount: 0 });
        })
      } as unknown as Pool & { queries: string[] };

      const v035 = migrations.find((m: Migration) => m.version === 35);
      if (!v035) {
        throw new Error('v035 migration not found');
      }

      await expect(v035.up(pool)).rejects.toThrow('forced v035 failure');
      expect(pool.queries[0]).toBe('BEGIN');
      expect(pool.queries).toContain('ROLLBACK');
      expect(pool.queries).not.toContain('COMMIT');
    });
  });

  describe('v036 migration', () => {
    it('verifies share retirement preconditions after checkpoint scaffolding', async () => {
      const pool = createMockPool(new Map());

      const v036 = migrations.find((m: Migration) => m.version === 36);
      if (!v036) {
        throw new Error('v036 migration not found');
      }

      await v036.up(pool);

      const queries = pool.queries.join('\n');
      expect(queries).toContain(
        'vfs_acl_entries missing before share retirement preconditions'
      );
      expect(queries).toContain(
        'vfs_shares missing before share retirement preconditions'
      );
      expect(queries).toContain(
        'org_shares missing before share retirement preconditions'
      );
      expect(queries).toContain(
        'share retirement checkpoints missing before precondition verification'
      );
      expect(queries).toContain(
        'no share retirement checkpoint rows recorded before precondition verification'
      );
      expect(queries).toContain(
        'vfs_shares rows missing canonical active ACL parity'
      );
      expect(queries).toContain(
        'org_shares rows missing canonical active ACL parity'
      );
      expect(queries).toContain(
        'share-sourced ACL rows orphaned from vfs_shares'
      );
      expect(queries).toContain(
        'org-share-sourced ACL rows orphaned from org_shares'
      );
    });

    it('remains transactional and rolls back on failure', async () => {
      const pool = {
        queries: [] as string[],
        query: vi.fn().mockImplementation((sql: string) => {
          (pool as { queries: string[] }).queries.push(sql);

          if (
            sql.includes('vfs_shares rows missing canonical active ACL parity')
          ) {
            throw new Error('forced v036 failure');
          }

          return Promise.resolve({ rows: [], rowCount: 0 });
        })
      } as unknown as Pool & { queries: string[] };

      const v036 = migrations.find((m: Migration) => m.version === 36);
      if (!v036) {
        throw new Error('v036 migration not found');
      }

      await expect(v036.up(pool)).rejects.toThrow('forced v036 failure');
      expect(pool.queries[0]).toBe('BEGIN');
      expect(pool.queries).toContain('ROLLBACK');
      expect(pool.queries).not.toContain('COMMIT');
    });
  });

  describe('v037 migration', () => {
    it('records share drop-planning checkpoint only after v036 guardrails', async () => {
      const pool = createMockPool(new Map());

      const v037 = migrations.find((m: Migration) => m.version === 37);
      if (!v037) {
        throw new Error('v037 migration not found');
      }

      await v037.up(pool);

      const queries = pool.queries.join('\n');
      expect(queries).toContain(
        'v036 must be recorded before share drop-planning checkpoint'
      );
      expect(queries).toContain(
        'vfs_acl_entries missing before share drop-planning checkpoint'
      );
      expect(queries).toContain(
        'vfs_shares missing before share drop-planning checkpoint'
      );
      expect(queries).toContain(
        'org_shares missing before share drop-planning checkpoint'
      );
      expect(queries).toContain(
        'share retirement checkpoints missing before share drop-planning checkpoint'
      );
      expect(queries).toContain(
        'no share retirement checkpoint rows recorded before share drop-planning checkpoint'
      );
      expect(queries).toContain(
        'vfs_shares rows missing canonical active ACL parity'
      );
      expect(queries).toContain(
        'org_shares rows missing canonical active ACL parity'
      );
      expect(queries).toContain(
        'share-sourced ACL rows orphaned from vfs_shares'
      );
      expect(queries).toContain(
        'org-share-sourced ACL rows orphaned from org_shares'
      );
      expect(queries).toContain(
        'CREATE TABLE IF NOT EXISTS "vfs_share_retirement_drop_plans"'
      );
      expect(queries).toContain(
        'INSERT INTO "vfs_share_retirement_drop_plans"'
      );
      expect(queries).toContain('vfs_shares_then_org_shares');
    });

    it('remains transactional and rolls back on failure', async () => {
      const pool = {
        queries: [] as string[],
        query: vi.fn().mockImplementation((sql: string) => {
          (pool as { queries: string[] }).queries.push(sql);

          if (sql.includes('INSERT INTO "vfs_share_retirement_drop_plans"')) {
            throw new Error('forced v037 failure');
          }

          return Promise.resolve({ rows: [], rowCount: 0 });
        })
      } as unknown as Pool & { queries: string[] };

      const v037 = migrations.find((m: Migration) => m.version === 37);
      if (!v037) {
        throw new Error('v037 migration not found');
      }

      await expect(v037.up(pool)).rejects.toThrow('forced v037 failure');
      expect(pool.queries[0]).toBe('BEGIN');
      expect(pool.queries).toContain('ROLLBACK');
      expect(pool.queries).not.toContain('COMMIT');
    });
  });

  describe('v038 migration', () => {
    it('records share drop-candidate dry-run checkpoint after v037 planning', async () => {
      const pool = createMockPool(new Map());

      const v038 = migrations.find((m: Migration) => m.version === 38);
      if (!v038) {
        throw new Error('v038 migration not found');
      }

      await v038.up(pool);

      const queries = pool.queries.join('\n');
      expect(queries).toContain(
        'v037 must be recorded before share drop-candidate dry-run'
      );
      expect(queries).toContain(
        'vfs_acl_entries missing before share drop-candidate dry-run'
      );
      expect(queries).toContain(
        'vfs_shares missing before share drop-candidate dry-run'
      );
      expect(queries).toContain(
        'org_shares missing before share drop-candidate dry-run'
      );
      expect(queries).toContain(
        'share retirement checkpoints missing before share drop-candidate dry-run'
      );
      expect(queries).toContain(
        'no share retirement checkpoint rows recorded before share drop-candidate dry-run'
      );
      expect(queries).toContain(
        'share drop-planning checkpoints missing before share drop-candidate dry-run'
      );
      expect(queries).toContain(
        'no share drop-planning rows recorded before share drop-candidate dry-run'
      );
      expect(queries).toContain(
        'expected share drop order checkpoint missing before dry-run'
      );
      expect(queries).toContain(
        'vfs_shares rows missing canonical active ACL parity'
      );
      expect(queries).toContain(
        'org_shares rows missing canonical active ACL parity'
      );
      expect(queries).toContain(
        'share-sourced ACL rows orphaned from vfs_shares'
      );
      expect(queries).toContain(
        'org-share-sourced ACL rows orphaned from org_shares'
      );
      expect(queries).toContain(
        'CREATE TABLE IF NOT EXISTS "vfs_share_retirement_drop_candidates"'
      );
      expect(queries).toContain(
        'INSERT INTO "vfs_share_retirement_drop_candidates"'
      );
      expect(queries).toContain('DROP TABLE "vfs_shares";');
      expect(queries).toContain('DROP TABLE "org_shares";');
    });

    it('remains transactional and rolls back on failure', async () => {
      const pool = {
        queries: [] as string[],
        query: vi.fn().mockImplementation((sql: string) => {
          (pool as { queries: string[] }).queries.push(sql);

          if (
            sql.includes('INSERT INTO "vfs_share_retirement_drop_candidates"')
          ) {
            throw new Error('forced v038 failure');
          }

          return Promise.resolve({ rows: [], rowCount: 0 });
        })
      } as unknown as Pool & { queries: string[] };

      const v038 = migrations.find((m: Migration) => m.version === 38);
      if (!v038) {
        throw new Error('v038 migration not found');
      }

      await expect(v038.up(pool)).rejects.toThrow('forced v038 failure');
      expect(pool.queries[0]).toBe('BEGIN');
      expect(pool.queries).toContain('ROLLBACK');
      expect(pool.queries).not.toContain('COMMIT');
    });
  });

  describe('v039 migration', () => {
    it('records share pre-drop execution readiness after v038 dry-run guardrails', async () => {
      const pool = createMockPool(new Map());

      const v039 = migrations.find((m: Migration) => m.version === 39);
      if (!v039) {
        throw new Error('v039 migration not found');
      }

      await v039.up(pool);

      const queries = pool.queries.join('\n');
      expect(queries).toContain(
        'v038 must be recorded before share pre-drop execution readiness'
      );
      expect(queries).toContain(
        'vfs_acl_entries missing before share pre-drop execution readiness'
      );
      expect(queries).toContain(
        'vfs_shares missing before share pre-drop execution readiness'
      );
      expect(queries).toContain(
        'org_shares missing before share pre-drop execution readiness'
      );
      expect(queries).toContain(
        'share drop-candidate checkpoints missing before share pre-drop execution readiness'
      );
      expect(queries).toContain(
        'vfs_shares drop-candidate readiness checkpoint missing before execution readiness'
      );
      expect(queries).toContain(
        'org_shares drop-candidate readiness checkpoint missing before execution readiness'
      );
      expect(queries).toContain(
        'vfs_shares rows missing canonical active ACL parity'
      );
      expect(queries).toContain(
        'org_shares rows missing canonical active ACL parity'
      );
      expect(queries).toContain(
        'share-sourced ACL rows orphaned from vfs_shares'
      );
      expect(queries).toContain(
        'org-share-sourced ACL rows orphaned from org_shares'
      );
      expect(queries).toContain(
        'CREATE TABLE IF NOT EXISTS "vfs_share_retirement_execution_readiness"'
      );
      expect(queries).toContain(
        'INSERT INTO "vfs_share_retirement_execution_readiness"'
      );
      expect(queries).toContain('legacy_share_read_surfaces_deactivated');
      expect(queries).toContain(
        'acl-first-share-read-path-with-transition-parity'
      );
      expect(queries).toContain(
        'GET /v1/vfs/items/:itemId/shares; loadShareAuthorizationContext; loadOrgShareAuthorizationContext'
      );
      expect(queries).toContain(
        'Legacy share-read surfaces must be deactivated and parity-validated before destructive share-table retirement.'
      );
    });

    it('remains transactional and rolls back on failure', async () => {
      const pool = {
        queries: [] as string[],
        query: vi.fn().mockImplementation((sql: string) => {
          (pool as { queries: string[] }).queries.push(sql);

          if (
            sql.includes(
              'INSERT INTO "vfs_share_retirement_execution_readiness"'
            )
          ) {
            throw new Error('forced v039 failure');
          }

          return Promise.resolve({ rows: [], rowCount: 0 });
        })
      } as unknown as Pool & { queries: string[] };

      const v039 = migrations.find((m: Migration) => m.version === 39);
      if (!v039) {
        throw new Error('v039 migration not found');
      }

      await expect(v039.up(pool)).rejects.toThrow('forced v039 failure');
      expect(pool.queries[0]).toBe('BEGIN');
      expect(pool.queries).toContain('ROLLBACK');
      expect(pool.queries).not.toContain('COMMIT');
    });
  });
});
