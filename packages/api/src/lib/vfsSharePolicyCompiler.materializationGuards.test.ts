import { describe, expect, it } from 'vitest';
import { compileVfsSharePolicies } from './vfsSharePolicyCompiler.js';

interface QueryCall {
  text: string;
  values?: unknown[] | undefined;
}

function normalizeSql(text: string): string {
  return text.replace(/\s+/gu, ' ').trim();
}

describe('compileVfsSharePolicies (materialization guards)', () => {
  it('does not fail when direct-provenance guard skips ACL upsert updates', async () => {
    const calls: QueryCall[] = [];
    const query = async <T>(text: string, values?: unknown[]) => {
      calls.push({ text: normalizeSql(text), values });
      if (text === 'BEGIN' || text === 'COMMIT' || text === 'ROLLBACK') {
        return { rows: [] as T[] };
      }
      if (text.includes('SELECT pg_advisory_xact_lock')) {
        return { rows: [] as T[] };
      }
      if (text.includes('FROM vfs_share_policies')) {
        return {
          rows: [
            {
              id: 'policy-a',
              root_item_id: 'root-1',
              status: 'active',
              revoked_at: null,
              expires_at: null
            }
          ] as T[]
        };
      }
      if (text.includes('FROM vfs_share_policy_selectors')) {
        return {
          rows: [
            {
              id: 'selector-a',
              policy_id: 'policy-a',
              selector_kind: 'include',
              match_mode: 'subtree',
              anchor_item_id: null,
              max_depth: null,
              include_root: false,
              object_types: null,
              selector_order: 1
            }
          ] as T[]
        };
      }
      if (text.includes('FROM vfs_share_policy_principals')) {
        return {
          rows: [
            {
              id: 'principal-a',
              policy_id: 'policy-a',
              principal_type: 'user',
              principal_id: 'alice',
              access_level: 'write'
            }
          ] as T[]
        };
      }
      if (text.includes('FROM vfs_registry')) {
        return {
          rows: [
            { id: 'root-1', object_type: 'contact' },
            { id: 'item-1', object_type: 'walletItem' }
          ] as T[]
        };
      }
      if (text.includes('FROM vfs_links')) {
        return {
          rows: [{ parent_id: 'root-1', child_id: 'item-1' }] as T[]
        };
      }
      if (text.includes('INSERT INTO vfs_acl_entries')) {
        return { rows: [] as T[] };
      }
      if (
        text.includes('FROM vfs_acl_entries e') &&
        text.includes("p.provenance_type = 'direct'")
      ) {
        return { rows: [{ id: 'existing-direct-acl-id' }] as T[] };
      }
      if (text.includes('INSERT INTO vfs_acl_entry_provenance')) {
        return { rows: [] as T[] };
      }
      if (text.includes('SELECT DISTINCT acl_entry_id')) {
        return { rows: [] as T[] };
      }
      throw new Error(`Unexpected query in skipped-upsert guard test: ${text}`);
    };

    const result = await compileVfsSharePolicies(
      { query },
      {
        now: new Date('2026-02-28T17:00:00.000Z'),
        compilerRunId: 'run-skip-direct-guard'
      }
    );

    expect(result.decisionsCount).toBe(1);
    expect(result.touchedAclEntryCount).toBe(0);
    expect(
      calls.some((call) =>
        call.text.includes('INSERT INTO vfs_acl_entry_provenance')
      )
    ).toBe(false);
    expect(
      calls.some(
        (call) =>
          call.text.includes('FROM vfs_acl_entries e') &&
          call.text.includes("p.provenance_type = 'direct'")
      )
    ).toBe(true);
    expect(calls.filter((call) => call.text === 'COMMIT')).toHaveLength(1);
  });

  it('throws when ACL upsert returns no row without direct-provenance protection', async () => {
    const query = async <T>(text: string) => {
      if (text === 'BEGIN' || text === 'COMMIT' || text === 'ROLLBACK') {
        return { rows: [] as T[] };
      }
      if (text.includes('SELECT pg_advisory_xact_lock')) {
        return { rows: [] as T[] };
      }
      if (text.includes('FROM vfs_share_policies')) {
        return {
          rows: [
            {
              id: 'policy-a',
              root_item_id: 'root-1',
              status: 'active',
              revoked_at: null,
              expires_at: null
            }
          ] as T[]
        };
      }
      if (text.includes('FROM vfs_share_policy_selectors')) {
        return {
          rows: [
            {
              id: 'selector-a',
              policy_id: 'policy-a',
              selector_kind: 'include',
              match_mode: 'subtree',
              anchor_item_id: null,
              max_depth: null,
              include_root: false,
              object_types: null,
              selector_order: 1
            }
          ] as T[]
        };
      }
      if (text.includes('FROM vfs_share_policy_principals')) {
        return {
          rows: [
            {
              id: 'principal-a',
              policy_id: 'policy-a',
              principal_type: 'user',
              principal_id: 'alice',
              access_level: 'write'
            }
          ] as T[]
        };
      }
      if (text.includes('FROM vfs_registry')) {
        return {
          rows: [
            { id: 'root-1', object_type: 'contact' },
            { id: 'item-1', object_type: 'walletItem' }
          ] as T[]
        };
      }
      if (text.includes('FROM vfs_links')) {
        return {
          rows: [{ parent_id: 'root-1', child_id: 'item-1' }] as T[]
        };
      }
      if (text.includes('INSERT INTO vfs_acl_entries')) {
        return { rows: [] as T[] };
      }
      if (
        text.includes('FROM vfs_acl_entries e') &&
        text.includes("p.provenance_type = 'direct'")
      ) {
        return { rows: [] as T[] };
      }
      if (text.includes('INSERT INTO vfs_acl_entry_provenance')) {
        return { rows: [] as T[] };
      }
      if (text.includes('SELECT DISTINCT acl_entry_id')) {
        return { rows: [] as T[] };
      }
      throw new Error(
        `Unexpected query in no-row materialization test: ${text}`
      );
    };

    await expect(
      compileVfsSharePolicies(
        { query },
        {
          now: new Date('2026-02-28T17:00:00.000Z'),
          compilerRunId: 'run-unexpected-no-row'
        }
      )
    ).rejects.toThrow('Failed to materialize ACL decision');
  });
});
