import { describe, expect, it } from 'vitest';
import { compileVfsSharePolicies } from './vfsSharePolicyCompiler.js';

interface QueryCall {
  text: string;
  values?: unknown[] | undefined;
}

function normalizeSql(text: string): string {
  return text.replace(/\s+/gu, ' ').trim();
}

describe('compileVfsSharePolicies (materialization)', () => {
  it('materializes derived ACLs and revokes stale derived entries', async () => {
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
    };

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
    expect(calls.filter((call) => call.text === 'BEGIN')).toHaveLength(1);
    expect(calls.filter((call) => call.text === 'COMMIT')).toHaveLength(1);
    expect(
      calls.filter((call) => call.text.includes('SELECT pg_advisory_xact_lock'))
    ).toHaveLength(1);
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
    expect(
      calls.filter((call) =>
        call.text.includes('DELETE FROM vfs_acl_entry_provenance')
      )
    ).toHaveLength(0);
  });

  it('respects existing direct grants during materialization', async () => {
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
        return { rows: [{ id: 'existing-direct-acl-id' }] as T[] };
      }
      if (text.includes('INSERT INTO vfs_acl_entry_provenance')) {
        return { rows: [] as T[] };
      }
      if (text.includes('SELECT DISTINCT acl_entry_id')) {
        return { rows: [] as T[] };
      }
      throw new Error(`Unexpected query in direct grant test: ${text}`);
    };

    await compileVfsSharePolicies(
      { query },
      {
        now: new Date('2026-02-28T17:00:00.000Z'),
        compilerRunId: 'run-direct-test'
      }
    );

    const upsertCall = calls.find((call) =>
      call.text.includes('INSERT INTO vfs_acl_entries')
    );
    expect(upsertCall?.text).toContain(
      'WHERE ( EXCLUDED.revoked_at IS NOT NULL'
    );
    expect(upsertCall?.text).toContain(
      "NOT EXISTS ( SELECT 1 FROM vfs_acl_entry_provenance p WHERE p.acl_entry_id = vfs_acl_entries.id AND p.provenance_type = 'direct' )"
    );
  });

  it('ensures policy-derived DENY wins over active direct grant', async () => {
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
              selector_kind: 'exclude',
              match_mode: 'exact',
              anchor_item_id: 'item-1',
              max_depth: null,
              include_root: true,
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
      if (text.includes('INSERT INTO vfs_acl_entries')) {
        return { rows: [{ id: 'existing-direct-acl-id' }] as T[] };
      }
      if (text.includes('INSERT INTO vfs_acl_entry_provenance')) {
        return { rows: [] as T[] };
      }
      if (text.includes('SELECT DISTINCT acl_entry_id')) {
        return { rows: [] as T[] };
      }
      throw new Error(`Unexpected query in direct grant test: ${text}`);
    };

    const result = await compileVfsSharePolicies(
      { query },
      {
        now: new Date('2026-02-28T17:00:00.000Z'),
        compilerRunId: 'run-deny-wins'
      }
    );

    expect(result.decisionsCount).toBe(1);
    const upsertCall = calls.find((call) =>
      call.text.includes('INSERT INTO vfs_acl_entries')
    );
    // index 7 is created_at, index 8 is revoked_at
    // we want decision === 'deny' so values[7] (index 8) is now
    expect(upsertCall?.values?.[7]).not.toBeNull();
  });
});
