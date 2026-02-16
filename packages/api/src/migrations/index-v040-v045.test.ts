import type { Pool } from 'pg';
import { describe, expect, it, vi } from 'vitest';
import { createMockPool, migrations } from './index-test-support.js';
import type { Migration } from './types.js';

describe('migrations (v040-v045)', () => {
  describe('v040 migration', () => {
    it('records share drop authorization checkpoints after v039 execution readiness', async () => {
      const pool = createMockPool(new Map());

      const v040 = migrations.find((m: Migration) => m.version === 40);
      if (!v040) {
        throw new Error('v040 migration not found');
      }

      await v040.up(pool);

      const queries = pool.queries.join('\n');
      expect(queries).toContain(
        'v039 must be recorded before share drop authorization guardrails'
      );
      expect(queries).toContain(
        'vfs_acl_entries missing before share drop authorization guardrails'
      );
      expect(queries).toContain(
        'vfs_shares missing before share drop authorization guardrails'
      );
      expect(queries).toContain(
        'org_shares missing before share drop authorization guardrails'
      );
      expect(queries).toContain(
        'share drop-candidate checkpoints missing before drop authorization guardrails'
      );
      expect(queries).toContain(
        'vfs_shares drop-candidate readiness checkpoint missing before drop authorization guardrails'
      );
      expect(queries).toContain(
        'org_shares drop-candidate readiness checkpoint missing before drop authorization guardrails'
      );
      expect(queries).toContain(
        'share execution-readiness checkpoints missing before drop authorization guardrails'
      );
      expect(queries).toContain(
        'required execution-readiness marker missing before drop authorization guardrails'
      );
      expect(queries).toContain(
        'canonical read contract mismatch before drop authorization guardrails'
      );
      expect(queries).toContain(
        'legacy read-surface inventory mismatch before drop authorization guardrails'
      );
      expect(queries).toContain(
        'latest execution-readiness marker must match canonical read contract before drop authorization guardrails'
      );
      expect(queries).toContain(
        'latest execution-readiness marker must match legacy read-surface inventory before drop authorization guardrails'
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
        'CREATE TABLE IF NOT EXISTS "vfs_share_retirement_drop_authorizations"'
      );
      expect(queries).toContain(
        'INSERT INTO "vfs_share_retirement_drop_authorizations"'
      );
      expect(queries).toContain('read_surface_deactivation_confirmed');
      expect(queries).toContain('is_drop_authorized');
      expect(queries).toContain(
        'read_surface_deactivation_confirmed must be TRUE before destructive share-table drop.'
      );
      expect(queries).toContain(
        'execution readiness checkpoint must be marked ready before destructive share-table drop.'
      );
      expect(queries).toContain("'authorized'");
    });

    it('remains transactional and rolls back on failure', async () => {
      const pool = {
        queries: [] as string[],
        query: vi.fn().mockImplementation((sql: string) => {
          (pool as { queries: string[] }).queries.push(sql);

          if (
            sql.includes(
              'INSERT INTO "vfs_share_retirement_drop_authorizations"'
            )
          ) {
            throw new Error('forced v040 failure');
          }

          return Promise.resolve({ rows: [], rowCount: 0 });
        })
      } as unknown as Pool & { queries: string[] };

      const v040 = migrations.find((m: Migration) => m.version === 40);
      if (!v040) {
        throw new Error('v040 migration not found');
      }

      await expect(v040.up(pool)).rejects.toThrow('forced v040 failure');
      expect(pool.queries[0]).toBe('BEGIN');
      expect(pool.queries).toContain('ROLLBACK');
      expect(pool.queries).not.toContain('COMMIT');
    });
  });

  describe('v041 migration', () => {
    it('records share drop execution candidates after v040 authorization checkpoints', async () => {
      const pool = createMockPool(new Map());

      const v041 = migrations.find((m: Migration) => m.version === 41);
      if (!v041) {
        throw new Error('v041 migration not found');
      }

      await v041.up(pool);

      const queries = pool.queries.join('\n');
      expect(queries).toContain(
        'v040 must be recorded before share drop execution candidates'
      );
      expect(queries).toContain(
        'share drop authorization checkpoints missing before execution candidates'
      );
      expect(queries).toContain(
        'vfs_shares step-1 authorization checkpoint missing before execution candidates'
      );
      expect(queries).toContain(
        'org_shares step-2 authorization checkpoint missing before execution candidates'
      );
      expect(queries).toContain(
        'CREATE TABLE IF NOT EXISTS "vfs_share_retirement_drop_execution_candidates"'
      );
      expect(queries).toContain(
        'INSERT INTO "vfs_share_retirement_drop_execution_candidates"'
      );
      expect(queries).toContain('DROP TABLE "vfs_shares";');
      expect(queries).toContain('DROP TABLE "org_shares";');
      expect(queries).toContain(
        'Latest vfs_shares authorization is not executable'
      );
      expect(queries).toContain(
        'org_shares drop is deferred until vfs_shares retirement completes.'
      );
      expect(queries).toContain("'executable'");
    });

    it('remains transactional and rolls back on failure', async () => {
      const pool = {
        queries: [] as string[],
        query: vi.fn().mockImplementation((sql: string) => {
          (pool as { queries: string[] }).queries.push(sql);

          if (
            sql.includes(
              'INSERT INTO "vfs_share_retirement_drop_execution_candidates"'
            )
          ) {
            throw new Error('forced v041 failure');
          }

          return Promise.resolve({ rows: [], rowCount: 0 });
        })
      } as unknown as Pool & { queries: string[] };

      const v041 = migrations.find((m: Migration) => m.version === 41);
      if (!v041) {
        throw new Error('v041 migration not found');
      }

      await expect(v041.up(pool)).rejects.toThrow('forced v041 failure');
      expect(pool.queries[0]).toBe('BEGIN');
      expect(pool.queries).toContain('ROLLBACK');
      expect(pool.queries).not.toContain('COMMIT');
    });
  });

  describe('v042 migration', () => {
    it('drops vfs_shares only when latest step-1 candidate is executable', async () => {
      const pool = createMockPool(new Map());

      const v042 = migrations.find((m: Migration) => m.version === 42);
      if (!v042) {
        throw new Error('v042 migration not found');
      }

      await v042.up(pool);

      const queries = pool.queries.join('\n');
      expect(queries).toContain('v041 must be recorded before vfs_shares drop');
      expect(queries).toContain('vfs_shares missing before step-1 drop');
      expect(queries).toContain(
        'vfs_acl_entries missing before vfs_shares drop'
      );
      expect(queries).toContain(
        'share drop execution candidates missing before vfs_shares drop'
      );
      expect(queries).toContain(
        'latest vfs_shares step-1 execution candidate is not executable'
      );
      expect(queries).toContain(
        'vfs_shares rows missing canonical active ACL parity at drop time'
      );
      expect(queries).toContain(
        'CREATE TABLE IF NOT EXISTS "vfs_share_retirement_drop_execution_audit"'
      );
      expect(queries).toContain('DROP TABLE "vfs_shares"');
      expect(queries).toContain(
        'INSERT INTO "vfs_share_retirement_drop_execution_audit"'
      );
      expect(queries).toContain("'step-1'");
      expect(queries).toContain("'dropped'");
    });

    it('remains transactional and rolls back on failure', async () => {
      const pool = {
        queries: [] as string[],
        query: vi.fn().mockImplementation((sql: string) => {
          (pool as { queries: string[] }).queries.push(sql);

          if (sql.includes('DROP TABLE "vfs_shares"')) {
            throw new Error('forced v042 failure');
          }

          return Promise.resolve({ rows: [], rowCount: 0 });
        })
      } as unknown as Pool & { queries: string[] };

      const v042 = migrations.find((m: Migration) => m.version === 42);
      if (!v042) {
        throw new Error('v042 migration not found');
      }

      await expect(v042.up(pool)).rejects.toThrow('forced v042 failure');
      expect(pool.queries[0]).toBe('BEGIN');
      expect(pool.queries).toContain('ROLLBACK');
      expect(pool.queries).not.toContain('COMMIT');
    });
  });

  describe('v043 migration', () => {
    it('drops org_shares only after step-1 drop audit and executable step-2 authorization', async () => {
      const pool = createMockPool(new Map());

      const v043 = migrations.find((m: Migration) => m.version === 43);
      if (!v043) {
        throw new Error('v043 migration not found');
      }

      await v043.up(pool);

      const queries = pool.queries.join('\n');
      expect(queries).toContain('v042 must be recorded before org_shares drop');
      expect(queries).toContain('org_shares missing before step-2 drop');
      expect(queries).toContain(
        'vfs_acl_entries missing before org_shares drop'
      );
      expect(queries).toContain(
        'share drop execution audit missing before org_shares drop'
      );
      expect(queries).toContain(
        'share drop execution candidates missing before org_shares drop'
      );
      expect(queries).toContain(
        'share drop authorizations missing before org_shares drop'
      );
      expect(queries).toContain(
        'vfs_shares step-1 drop audit success missing before org_shares drop'
      );
      expect(queries).toContain(
        'latest org_shares step-2 authorization is not executable'
      );
      expect(queries).toContain(
        'INSERT INTO "vfs_share_retirement_drop_execution_candidates"'
      );
      expect(queries).toContain(
        'latest org_shares step-2 execution candidate is not executable'
      );
      expect(queries).toContain(
        'org_shares rows missing canonical active ACL parity at drop time'
      );
      expect(queries).toContain('DROP TABLE "org_shares"');
      expect(queries).toContain(
        'INSERT INTO "vfs_share_retirement_drop_execution_audit"'
      );
      expect(queries).toContain("'step-2'");
      expect(queries).toContain("'dropped'");
    });

    it('remains transactional and rolls back on failure', async () => {
      const pool = {
        queries: [] as string[],
        query: vi.fn().mockImplementation((sql: string) => {
          (pool as { queries: string[] }).queries.push(sql);

          if (sql.includes('DROP TABLE "org_shares"')) {
            throw new Error('forced v043 failure');
          }

          return Promise.resolve({ rows: [], rowCount: 0 });
        })
      } as unknown as Pool & { queries: string[] };

      const v043 = migrations.find((m: Migration) => m.version === 43);
      if (!v043) {
        throw new Error('v043 migration not found');
      }

      await expect(v043.up(pool)).rejects.toThrow('forced v043 failure');
      expect(pool.queries[0]).toBe('BEGIN');
      expect(pool.queries).toContain('ROLLBACK');
      expect(pool.queries).not.toContain('COMMIT');
    });
  });

  describe('v044 migration', () => {
    it('drops retirement scaffolding only after both share-drop audits succeed', async () => {
      const pool = createMockPool(new Map());

      const v044 = migrations.find((m: Migration) => m.version === 44);
      if (!v044) {
        throw new Error('v044 migration not found');
      }

      await v044.up(pool);

      const queries = pool.queries.join('\n');
      expect(queries).toContain(
        'v043 must be recorded before share retirement finalization'
      );
      expect(queries).toContain(
        'vfs_shares still exists before share retirement finalization'
      );
      expect(queries).toContain(
        'org_shares still exists before share retirement finalization'
      );
      expect(queries).toContain(
        'share drop execution audit missing before finalization'
      );
      expect(queries).toContain(
        'step-1 drop audit missing before share retirement finalization'
      );
      expect(queries).toContain(
        'step-2 drop audit missing before share retirement finalization'
      );
      expect(queries).toContain(
        'DROP TABLE IF EXISTS "vfs_share_retirement_checkpoints"'
      );
      expect(queries).toContain(
        'DROP TABLE IF EXISTS "vfs_share_retirement_drop_plans"'
      );
      expect(queries).toContain(
        'DROP TABLE IF EXISTS "vfs_share_retirement_drop_candidates"'
      );
      expect(queries).toContain(
        'DROP TABLE IF EXISTS "vfs_share_retirement_execution_readiness"'
      );
      expect(queries).toContain(
        'DROP TABLE IF EXISTS "vfs_share_retirement_drop_authorizations"'
      );
      expect(queries).toContain(
        'DROP TABLE IF EXISTS "vfs_share_retirement_drop_execution_candidates"'
      );
      expect(queries).toContain(
        'INSERT INTO "vfs_share_retirement_drop_execution_audit"'
      );
      expect(queries).toContain("'share_retirement'");
      expect(queries).toContain("'scaffolding_retired'");
    });

    it('remains transactional and rolls back on failure', async () => {
      const pool = {
        queries: [] as string[],
        query: vi.fn().mockImplementation((sql: string) => {
          (pool as { queries: string[] }).queries.push(sql);

          if (
            sql.includes(
              'DROP TABLE IF EXISTS "vfs_share_retirement_drop_authorizations"'
            )
          ) {
            throw new Error('forced v044 failure');
          }

          return Promise.resolve({ rows: [], rowCount: 0 });
        })
      } as unknown as Pool & { queries: string[] };

      const v044 = migrations.find((m: Migration) => m.version === 44);
      if (!v044) {
        throw new Error('v044 migration not found');
      }

      await expect(v044.up(pool)).rejects.toThrow('forced v044 failure');
      expect(pool.queries[0]).toBe('BEGIN');
      expect(pool.queries).toContain('ROLLBACK');
      expect(pool.queries).not.toContain('COMMIT');
    });
  });

  describe('v045 migration', () => {
    it('canonicalizes active legacy org-share ACL ids with fail-closed source inference', async () => {
      const pool = createMockPool(new Map());

      const v045 = migrations.find((m: Migration) => m.version === 45);
      if (!v045) {
        throw new Error('v045 migration not found');
      }

      await v045.up(pool);

      const queries = pool.queries.join('\n');
      expect(queries).toContain(
        'v044 must be recorded before org-share ACL canonicalization'
      );
      expect(queries).toContain(
        'vfs_acl_entries missing before org-share ACL canonicalization'
      );
      expect(queries).toContain(
        'user_organizations missing before org-share ACL canonicalization'
      );
      expect(queries).toContain(
        'CREATE TEMP TABLE "_v045_legacy_org_share_acl"'
      );
      expect(queries).toContain(
        'CREATE TEMP TABLE "_v045_resolved_org_share_acl"'
      );
      expect(queries).toContain(
        'active legacy org-share ACL rows are not uniquely source-resolvable'
      );
      expect(queries).toContain(
        'canonicalized source org ids contain unsupported separators'
      );
      expect(queries).toContain(
        'canonicalized share ids contain unsupported separators'
      );
      expect(queries).toContain(
        'canonicalized org-share ACL ids would collide with existing ACL ids'
      );
      expect(queries).toContain('UPDATE "vfs_acl_entries" acl');
      expect(queries).toContain(
        'active legacy org-share ACL ids remain after canonicalization'
      );
    });

    it('remains transactional and rolls back on failure', async () => {
      const pool = {
        queries: [] as string[],
        query: vi.fn().mockImplementation((sql: string) => {
          (pool as { queries: string[] }).queries.push(sql);

          if (sql.includes('UPDATE "vfs_acl_entries" acl')) {
            throw new Error('forced v045 failure');
          }

          return Promise.resolve({ rows: [], rowCount: 0 });
        })
      } as unknown as Pool & { queries: string[] };

      const v045 = migrations.find((m: Migration) => m.version === 45);
      if (!v045) {
        throw new Error('v045 migration not found');
      }

      await expect(v045.up(pool)).rejects.toThrow('forced v045 failure');
      expect(pool.queries[0]).toBe('BEGIN');
      expect(pool.queries).toContain('ROLLBACK');
      expect(pool.queries).not.toContain('COMMIT');
    });
  });
});
