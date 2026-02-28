import { describe, expect, it, vi } from 'vitest';
import { compileVfsSharePolicies } from './vfsSharePolicyCompiler.js';

interface QueryCall {
  text: string;
  values?: unknown[];
}

function normalizeSql(text: string): string {
  return text.replace(/\s+/gu, ' ').trim();
}

describe('compileVfsSharePolicies', () => {
  it('short-circuits when policyIds normalize to an empty set', async () => {
    const query = vi.fn(async <T>() => ({ rows: [] as T[] }));

    const result = await compileVfsSharePolicies(
      { query },
      {
        now: new Date('2026-02-28T17:00:00.000Z'),
        policyIds: [' ', '']
      }
    );

    expect(result.policyCount).toBe(0);
    expect(result.decisionsCount).toBe(0);
    expect(result.touchedAclEntryCount).toBe(0);
    expect(query).not.toHaveBeenCalled();
  });

  it('scopes policy loading and stale lookup to provided policy ids', async () => {
    const calls: QueryCall[] = [];
    const query = vi.fn(async <T>(text: string, values?: unknown[]) => {
      calls.push({ text: normalizeSql(text), values });
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
        return { rows: [] as T[] };
      }
      if (text.includes('FROM vfs_registry')) {
        return {
          rows: [{ id: 'root-1', object_type: 'contact' }] as T[]
        };
      }
      if (text.includes('FROM vfs_links')) {
        return { rows: [] as T[] };
      }
      if (
        text.includes('SELECT DISTINCT acl_entry_id') &&
        text.includes('FROM vfs_acl_entry_provenance')
      ) {
        return { rows: [] as T[] };
      }
      throw new Error(`Unexpected query in scoped compile: ${text}`);
    });

    const result = await compileVfsSharePolicies(
      { query },
      {
        now: new Date('2026-02-28T17:00:00.000Z'),
        compilerRunId: 'run-scoped',
        policyIds: ['policy-b', 'policy-a', 'policy-b']
      }
    );

    expect(result.compilerRunId).toBe('run-scoped');
    expect(result.policyCount).toBe(1);
    expect(result.principalCount).toBe(0);
    expect(result.decisionsCount).toBe(0);
    expect(result.staleRevocationCount).toBe(0);

    const policyQuery = calls.find((call) =>
      call.text.includes('FROM vfs_share_policies')
    );
    expect(policyQuery?.text).toContain('WHERE id = ANY($1::text[])');
    expect(policyQuery?.values).toEqual([['policy-a', 'policy-b']]);

    const selectorQuery = calls.find((call) =>
      call.text.includes('FROM vfs_share_policy_selectors')
    );
    expect(selectorQuery?.text).toContain('WHERE policy_id = ANY($1::text[])');
    expect(selectorQuery?.values).toEqual([['policy-a', 'policy-b']]);

    const principalQuery = calls.find((call) =>
      call.text.includes('FROM vfs_share_policy_principals')
    );
    expect(principalQuery?.text).toContain('WHERE policy_id = ANY($1::text[])');
    expect(principalQuery?.values).toEqual([['policy-a', 'policy-b']]);

    const staleQuery = calls.find((call) =>
      call.text.includes('SELECT DISTINCT acl_entry_id')
    );
    expect(staleQuery?.text).toContain('AND policy_id = ANY($1::text[])');
    expect(staleQuery?.values).toEqual([['policy-a', 'policy-b']]);
  });

  it('supports deterministic dry-run compilation without writes', async () => {
    const calls: QueryCall[] = [];
    const query = vi.fn(async <T>(text: string) => {
      calls.push({ text: normalizeSql(text) });
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
              access_level: 'read'
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
      throw new Error(`Unexpected query in dry run: ${text}`);
    });

    const result = await compileVfsSharePolicies(
      { query },
      {
        now: new Date('2026-02-28T17:00:00.000Z'),
        compilerRunId: 'run-dry',
        dryRun: true
      }
    );

    expect(result.compilerRunId).toBe('run-dry');
    expect(result.decisionsCount).toBe(1);
    expect(result.touchedAclEntryCount).toBe(0);
    expect(result.staleRevocationCount).toBe(0);
    expect(calls).toHaveLength(5);
    expect(
      calls.some((call) => call.text.includes('INSERT INTO vfs_acl_entries'))
    ).toBe(false);
  });

  it('materializes derived ACLs and revokes stale derived entries', async () => {
    const calls: QueryCall[] = [];
    const query = vi.fn(async <T>(text: string, values?: unknown[]) => {
      calls.push({ text: normalizeSql(text), values });
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
              id: 'selector-include',
              policy_id: 'policy-a',
              selector_kind: 'include',
              match_mode: 'subtree',
              anchor_item_id: null,
              max_depth: null,
              include_root: false,
              object_types: null,
              selector_order: 1
            },
            {
              id: 'selector-exclude-wallet',
              policy_id: 'policy-a',
              selector_kind: 'exclude',
              match_mode: 'exact',
              anchor_item_id: 'wallet-1',
              max_depth: null,
              include_root: true,
              object_types: null,
              selector_order: 2
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
              access_level: 'read'
            }
          ] as T[]
        };
      }
      if (text.includes('FROM vfs_registry')) {
        return {
          rows: [
            { id: 'root-1', object_type: 'contact' },
            { id: 'wallet-1', object_type: 'walletItem' },
            { id: 'workout-1', object_type: 'healthWorkoutEntry' }
          ] as T[]
        };
      }
      if (text.includes('FROM vfs_links')) {
        return {
          rows: [
            { parent_id: 'root-1', child_id: 'wallet-1' },
            { parent_id: 'root-1', child_id: 'workout-1' }
          ] as T[]
        };
      }
      if (text.includes('INSERT INTO vfs_acl_entries')) {
        const aclId = values?.[0];
        return { rows: [{ id: String(aclId) }] as T[] };
      }
      if (
        text.includes('SELECT DISTINCT acl_entry_id') &&
        text.includes('FROM vfs_acl_entry_provenance')
      ) {
        return {
          rows: [
            { acl_entry_id: 'policy-compiled:user:alice:wallet-1' },
            { acl_entry_id: 'policy-compiled:user:alice:workout-1' },
            { acl_entry_id: 'policy-compiled:user:alice:stale-item' }
          ] as T[]
        };
      }
      if (text.includes('DELETE FROM vfs_acl_entry_provenance')) {
        return { rows: [] as T[] };
      }
      if (text.includes('INSERT INTO vfs_acl_entry_provenance')) {
        return { rows: [] as T[] };
      }
      if (text.includes('UPDATE vfs_acl_entries')) {
        return { rows: [] as T[] };
      }
      if (text.includes('UPDATE vfs_acl_entry_provenance')) {
        return { rows: [] as T[] };
      }
      throw new Error(`Unexpected query in materialization: ${text}`);
    });

    const result = await compileVfsSharePolicies(
      { query },
      {
        now: new Date('2026-02-28T17:00:00.000Z'),
        compilerRunId: 'run-materialize',
        actorId: 'compiler-user'
      }
    );

    expect(result.compilerRunId).toBe('run-materialize');
    expect(result.decisionsCount).toBe(2);
    expect(result.touchedAclEntryCount).toBe(2);
    expect(result.staleRevocationCount).toBe(1);
    expect(
      calls.filter((call) => call.text.includes('INSERT INTO vfs_acl_entries'))
    ).toHaveLength(2);
    expect(
      calls.filter((call) =>
        call.text.includes('INSERT INTO vfs_acl_entry_provenance')
      )
    ).toHaveLength(2);
    expect(
      calls.filter((call) => call.text.includes('UPDATE vfs_acl_entries'))
    ).toHaveLength(1);
    expect(
      calls.filter((call) =>
        call.text.includes('UPDATE vfs_acl_entry_provenance')
      )
    ).toHaveLength(1);
  });
});
