import { describe, expect, it, vi } from 'vitest';
import { compileVfsSharePolicies } from './vfsSharePolicyCompiler.js';
import {
  compileSharePolicyCore,
  type LinkEdge,
  type RegistryItemType,
  type SharePolicyDefinition,
  type SharePolicyPrincipalDefinition,
  type SharePolicySelectorDefinition
} from './vfsSharePolicyCompilerCore.js';

const NOW = new Date('2026-02-28T20:00:00.000Z');

function activePolicy(id: string, rootItemId: string): SharePolicyDefinition {
  return {
    id,
    rootItemId,
    status: 'active',
    revokedAt: null,
    expiresAt: null
  };
}

describe('share policy rollout determinism', () => {
  it('produces deterministic core decisions across unsorted inputs', () => {
    const policies: SharePolicyDefinition[] = [
      activePolicy('policy-z', 'contact-root'),
      activePolicy('policy-a', 'playlist-root')
    ];
    const selectors: SharePolicySelectorDefinition[] = [
      {
        id: 'selector-z-include',
        policyId: 'policy-z',
        selectorKind: 'include',
        matchMode: 'subtree',
        anchorItemId: null,
        maxDepth: null,
        includeRoot: false,
        objectTypes: null,
        selectorOrder: 20
      },
      {
        id: 'selector-z-exclude',
        policyId: 'policy-z',
        selectorKind: 'exclude',
        matchMode: 'exact',
        anchorItemId: 'wallet-1',
        maxDepth: null,
        includeRoot: true,
        objectTypes: null,
        selectorOrder: 30
      },
      {
        id: 'selector-a-include',
        policyId: 'policy-a',
        selectorKind: 'include',
        matchMode: 'exact',
        anchorItemId: null,
        maxDepth: null,
        includeRoot: true,
        objectTypes: null,
        selectorOrder: 10
      }
    ];
    const principals: SharePolicyPrincipalDefinition[] = [
      {
        id: 'principal-2',
        policyId: 'policy-a',
        principalType: 'user',
        principalId: 'alice',
        accessLevel: 'write'
      },
      {
        id: 'principal-1',
        policyId: 'policy-z',
        principalType: 'user',
        principalId: 'alice',
        accessLevel: 'read'
      }
    ];
    const registryItems: RegistryItemType[] = [
      { id: 'contact-root', objectType: 'contact' },
      { id: 'playlist-root', objectType: 'playlist' },
      { id: 'workout-1', objectType: 'healthWorkoutEntry' },
      { id: 'wallet-1', objectType: 'walletItem' }
    ];
    const links: LinkEdge[] = [
      { parentId: 'contact-root', childId: 'wallet-1' },
      { parentId: 'contact-root', childId: 'workout-1' }
    ];

    const firstRun = compileSharePolicyCore({
      policies,
      selectors,
      principals,
      registryItems,
      links,
      now: NOW
    });
    const secondRun = compileSharePolicyCore({
      policies: [...policies].reverse(),
      selectors: [...selectors].reverse(),
      principals: [...principals].reverse(),
      registryItems: [...registryItems].reverse(),
      links: [...links].reverse(),
      now: NOW
    });

    expect(secondRun).toEqual(firstRun);
    expect(firstRun.decisions).toEqual([
      {
        itemId: 'playlist-root',
        principalType: 'user',
        principalId: 'alice',
        decision: 'allow',
        accessLevel: 'write',
        policyId: 'policy-a',
        selectorId: 'selector-a-include',
        precedence: 10
      },
      {
        itemId: 'wallet-1',
        principalType: 'user',
        principalId: 'alice',
        decision: 'deny',
        accessLevel: 'read',
        policyId: 'policy-z',
        selectorId: 'selector-z-exclude',
        precedence: 30
      },
      {
        itemId: 'workout-1',
        principalType: 'user',
        principalId: 'alice',
        decision: 'allow',
        accessLevel: 'read',
        policyId: 'policy-z',
        selectorId: 'selector-z-include',
        precedence: 20
      }
    ]);
  });

  it('keeps materialized ACL/provenance state idempotent across reruns', async () => {
    interface AclEntryRow {
      id: string;
      itemId: string;
      principalType: string;
      principalId: string;
      accessLevel: string;
      revokedAt: Date | null;
    }

    interface ProvenanceRow {
      id: string;
      aclEntryId: string;
      decision: 'allow' | 'deny';
      policyId: string | null;
      selectorId: string | null;
      precedence: number;
      compilerRunId: string;
      compiledAt: Date;
    }

    const aclByCompositeKey = new Map<string, AclEntryRow>();
    const aclById = new Map<string, AclEntryRow>();
    const provenanceById = new Map<string, ProvenanceRow>();

    const query = vi.fn(async <T>(text: string, values?: unknown[]) => {
      if (
        text === 'BEGIN' ||
        text === 'COMMIT' ||
        text === 'ROLLBACK' ||
        text.includes('SELECT pg_advisory_xact_lock')
      ) {
        return { rows: [] as T[] };
      }
      if (text.includes('FROM vfs_share_policies')) {
        return {
          rows: [
            {
              id: 'policy-a',
              root_item_id: 'contact-root',
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
              principal_id: 'target-user',
              access_level: 'read'
            }
          ] as T[]
        };
      }
      if (text.includes('FROM vfs_registry')) {
        return {
          rows: [
            { id: 'contact-root', object_type: 'contact' },
            { id: 'wallet-1', object_type: 'walletItem' }
          ] as T[]
        };
      }
      if (text.includes('FROM vfs_links')) {
        return {
          rows: [{ parent_id: 'contact-root', child_id: 'wallet-1' }] as T[]
        };
      }
      if (text.includes('INSERT INTO vfs_acl_entries')) {
        const compositeKey = `${values?.[1]}::${values?.[2]}::${values?.[3]}`;
        const existing = aclByCompositeKey.get(compositeKey);
        const id = existing?.id ?? String(values?.[0]);
        const row: AclEntryRow = {
          id,
          itemId: String(values?.[1]),
          principalType: String(values?.[2]),
          principalId: String(values?.[3]),
          accessLevel: String(values?.[4]),
          revokedAt:
            values?.[7] instanceof Date
              ? values[7]
              : values?.[7] === null
                ? null
                : null
        };
        aclByCompositeKey.set(compositeKey, row);
        aclById.set(id, row);
        return { rows: [{ id }] as T[] };
      }
      if (text.includes('INSERT INTO vfs_acl_entry_provenance')) {
        const row: ProvenanceRow = {
          id: String(values?.[0]),
          aclEntryId: String(values?.[1]),
          policyId:
            typeof values?.[2] === 'string' ? values[2] : values?.[2] ? '' : null,
          selectorId:
            typeof values?.[3] === 'string' ? values[3] : values?.[3] ? '' : null,
          decision: values?.[4] === 'deny' ? 'deny' : 'allow',
          precedence: Number(values?.[5] ?? 0),
          compiledAt:
            values?.[6] instanceof Date ? values[6] : new Date(NOW.getTime()),
          compilerRunId: String(values?.[7])
        };
        provenanceById.set(row.id, row);
        return { rows: [] as T[] };
      }
      if (
        text.includes('SELECT DISTINCT acl_entry_id') &&
        text.includes('FROM vfs_acl_entry_provenance')
      ) {
        return {
          rows: Array.from(provenanceById.values()).map((row) => ({
            acl_entry_id: row.aclEntryId
          })) as T[]
        };
      }
      if (text.includes('UPDATE vfs_acl_entries')) {
        const row = aclById.get(String(values?.[1]));
        if (row) {
          row.revokedAt = values?.[0] instanceof Date ? values[0] : row.revokedAt;
        }
        return { rows: [] as T[] };
      }
      if (text.includes('UPDATE vfs_acl_entry_provenance')) {
        for (const row of provenanceById.values()) {
          if (row.aclEntryId !== String(values?.[2])) {
            continue;
          }
          row.decision = 'deny';
          row.policyId = null;
          row.selectorId = null;
          row.precedence = 0;
          row.compiledAt =
            values?.[0] instanceof Date ? values[0] : row.compiledAt;
          row.compilerRunId = String(values?.[1]);
        }
        return { rows: [] as T[] };
      }

      throw new Error(`Unexpected query in idempotency test: ${text}`);
    });

    const firstRun = await compileVfsSharePolicies(
      { query },
      {
        now: NOW,
        compilerRunId: 'run-1',
        actorId: 'system'
      }
    );
    const secondRun = await compileVfsSharePolicies(
      { query },
      {
        now: NOW,
        compilerRunId: 'run-2',
        actorId: 'system'
      }
    );

    expect(firstRun).toEqual({
      compilerRunId: 'run-1',
      policyCount: 1,
      activePolicyCount: 1,
      selectorCount: 1,
      principalCount: 1,
      expandedMatchCount: 1,
      decisionsCount: 1,
      touchedAclEntryCount: 1,
      staleRevocationCount: 0
    });
    expect(secondRun).toEqual({
      compilerRunId: 'run-2',
      policyCount: 1,
      activePolicyCount: 1,
      selectorCount: 1,
      principalCount: 1,
      expandedMatchCount: 1,
      decisionsCount: 1,
      touchedAclEntryCount: 1,
      staleRevocationCount: 0
    });
    expect(aclByCompositeKey.size).toBe(1);
    expect(provenanceById.size).toBe(1);
    expect(Array.from(provenanceById.values())[0]?.compilerRunId).toBe('run-2');
  });
});
