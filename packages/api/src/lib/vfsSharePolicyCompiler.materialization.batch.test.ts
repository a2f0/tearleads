import { describe, expect, it } from 'vitest';
import { compileVfsSharePolicies } from './vfsSharePolicyCompiler.js';

interface QueryCall {
  text: string;
  values?: unknown[] | undefined;
}

function normalizeSql(text: string): string {
  return text.replace(/\s+/gu, ' ').trim();
}

describe('compileVfsSharePolicies (materialization batch)', () => {
  it('materializes large decision sets with batched ACL/provenance writes', async () => {
    const descendantCount = 60;
    const descendantIds = Array.from(
      { length: descendantCount },
      (_, index) => `item-${index.toString().padStart(3, '0')}`
    );
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
              access_level: 'read'
            }
          ] as T[]
        };
      }
      if (text.includes('FROM vfs_registry')) {
        return {
          rows: [
            { id: 'root-1', object_type: 'contact' },
            ...descendantIds.map((id) => ({ id, object_type: 'walletItem' }))
          ] as T[]
        };
      }
      if (text.includes('FROM vfs_links')) {
        return {
          rows: descendantIds.map((id) => ({
            parent_id: 'root-1',
            child_id: id
          })) as T[]
        };
      }
      if (
        text.includes('WITH input_rows AS') &&
        text.includes('INSERT INTO vfs_acl_entries')
      ) {
        const inputItemIds = values?.[1];
        const inputPrincipalTypes = values?.[2];
        const inputPrincipalIds = values?.[3];
        if (
          !Array.isArray(inputItemIds) ||
          !Array.isArray(inputPrincipalTypes) ||
          !Array.isArray(inputPrincipalIds)
        ) {
          throw new Error('Expected array-based batched ACL inputs');
        }

        expect(inputItemIds).toHaveLength(descendantCount);
        return {
          rows: inputItemIds.map((itemId, index) => ({
            id: `policy-compiled:${String(inputPrincipalTypes[index])}:${String(inputPrincipalIds[index])}:${String(itemId)}`,
            item_id: String(itemId),
            principal_type: String(inputPrincipalTypes[index]),
            principal_id: String(inputPrincipalIds[index])
          })) as T[]
        };
      }
      if (
        text.includes('INSERT INTO vfs_acl_entry_provenance') &&
        text.includes('FROM UNNEST')
      ) {
        const provenanceIds = values?.[2];
        if (!Array.isArray(provenanceIds)) {
          throw new Error('Expected batched provenance ids array');
        }

        expect(provenanceIds).toHaveLength(descendantCount);
        return { rows: [] as T[] };
      }
      if (text.includes('SELECT DISTINCT acl_entry_id')) {
        return { rows: [] as T[] };
      }
      throw new Error(
        `Unexpected query in batched materialization test: ${text}`
      );
    };

    const result = await compileVfsSharePolicies(
      { query },
      {
        now: new Date('2026-02-28T17:00:00.000Z'),
        compilerRunId: 'run-batched'
      }
    );

    expect(result.decisionsCount).toBe(descendantCount);
    expect(result.touchedAclEntryCount).toBe(descendantCount);
    expect(result.staleRevocationCount).toBe(0);
    expect(
      calls.filter(
        (call) =>
          call.text.includes('WITH input_rows AS') &&
          call.text.includes('INSERT INTO vfs_acl_entries')
      )
    ).toHaveLength(1);
    expect(
      calls.filter(
        (call) =>
          call.text.includes('INSERT INTO vfs_acl_entry_provenance') &&
          call.text.includes('FROM UNNEST')
      )
    ).toHaveLength(1);
  });
});
