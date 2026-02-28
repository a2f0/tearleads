import { performance } from 'node:perf_hooks';
import { describe, expect, it } from 'vitest';
import { compileSharePolicyCore } from './vfsSharePolicyCompilerCore.js';
import { buildSharePolicyPreviewTree } from './vfsSharePolicyPreviewTree.js';

const NOW = new Date('2026-02-28T21:00:00.000Z');
const COMPILE_BUDGET_MS = 900;
const PREVIEW_BUDGET_MS = 700;

describe('share policy rollout performance budgets', () => {
  it('keeps core compile within budget for large single-root fanout', () => {
    const descendantCount = 6_000;
    const registryItems = [
      { id: 'root-1', objectType: 'contact' },
      ...Array.from({ length: descendantCount }, (_, index) => ({
        id: `item-${index.toString().padStart(5, '0')}`,
        objectType: index % 2 === 0 ? 'walletItem' : 'healthWorkoutEntry'
      }))
    ];
    const links = Array.from({ length: descendantCount }, (_, index) => ({
      parentId: 'root-1',
      childId: `item-${index.toString().padStart(5, '0')}`
    }));

    const input = {
      policies: [
        {
          id: 'policy-a',
          rootItemId: 'root-1',
          status: 'active' as const,
          revokedAt: null,
          expiresAt: null
        }
      ],
      selectors: [
        {
          id: 'selector-a',
          policyId: 'policy-a',
          selectorKind: 'include' as const,
          matchMode: 'subtree' as const,
          anchorItemId: null,
          maxDepth: null,
          includeRoot: false,
          objectTypes: null,
          selectorOrder: 1
        }
      ],
      principals: [
        {
          id: 'principal-a',
          policyId: 'policy-a',
          principalType: 'user' as const,
          principalId: 'target-user',
          accessLevel: 'read' as const
        }
      ],
      registryItems,
      links,
      now: NOW
    };

    compileSharePolicyCore(input);

    const startedAtMs = performance.now();
    const result = compileSharePolicyCore(input);
    const durationMs = performance.now() - startedAtMs;

    expect(result.decisions).toHaveLength(descendantCount);
    expect(durationMs).toBeLessThan(COMPILE_BUDGET_MS);
  });

  it('keeps preview tree projection within budget for deep pages', async () => {
    const nodeCount = 1_500;
    const totalMatchingNodes = 4_800;
    const pagedRows = Array.from({ length: nodeCount + 1 }, (_, index) => ({
      item_id: `node-${index.toString().padStart(5, '0')}`,
      object_type:
        index % 3 === 0
          ? 'walletItem'
          : index % 3 === 1
            ? 'healthWorkoutEntry'
            : 'note',
      depth: index === 0 ? 0 : 1,
      node_path:
        index === 0
          ? 'root-1'
          : `root-1/node-${index.toString().padStart(5, '0')}`
    }));
    const revokedAt = new Date('2026-01-01T00:00:00.000Z');
    const aclRows = pagedRows.slice(0, nodeCount).map((row, index) => ({
      id:
        index % 3 === 0
          ? `policy-compiled:user:target-user:${row.item_id}`
          : `share:${row.item_id}`,
      item_id: row.item_id,
      access_level:
        index % 2 === 0 ? ('write' as const) : ('read' as const),
      revoked_at: index % 3 === 2 ? revokedAt : null
    }));
    const provenanceRows = aclRows
      .filter((row) => row.id.startsWith('policy-compiled:'))
      .flatMap((row) => [
        { acl_entry_id: row.id, policy_id: 'policy-a' },
        { acl_entry_id: row.id, policy_id: 'policy-b' }
      ]);

    const query = async <T>(text: string, values?: unknown[]) => {
      if (text.includes('SELECT item_id, object_type, depth, node_path')) {
        return {
          rows: pagedRows as T[]
        };
      }
      if (text.includes('SELECT COUNT(*)::bigint AS total_count')) {
        return {
          rows: [{ total_count: totalMatchingNodes }] as T[]
        };
      }
      if (text.includes('FROM vfs_acl_entries')) {
        const itemIds = values?.[0];
        if (!Array.isArray(itemIds)) {
          throw new Error('Expected preview ACL lookup item id array');
        }
        expect(itemIds).toHaveLength(nodeCount);
        return {
          rows: aclRows as T[]
        };
      }
      if (text.includes('FROM vfs_acl_entry_provenance')) {
        return {
          rows: provenanceRows as T[]
        };
      }
      throw new Error(`Unexpected query in preview perf test: ${text}`);
    };

    await buildSharePolicyPreviewTree(
      { query },
      {
        rootItemId: 'root-1',
        principalType: 'user',
        principalId: 'target-user',
        limit: nodeCount,
        cursor: null,
        maxDepth: null,
        search: null,
        objectTypes: null
      }
    );

    const startedAtMs = performance.now();
    const result = await buildSharePolicyPreviewTree(
      { query },
      {
        rootItemId: 'root-1',
        principalType: 'user',
        principalId: 'target-user',
        limit: nodeCount,
        cursor: null,
        maxDepth: null,
        search: null,
        objectTypes: null
      }
    );
    const durationMs = performance.now() - startedAtMs;

    expect(result.nodes).toHaveLength(nodeCount);
    expect(result.summary.totalMatchingNodes).toBe(totalMatchingNodes);
    expect(result.nextCursor).toBe('root-1/node-01499');
    expect(durationMs).toBeLessThan(PREVIEW_BUDGET_MS);
  });
});
