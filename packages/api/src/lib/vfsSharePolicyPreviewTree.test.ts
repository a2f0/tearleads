import { describe, expect, it } from 'vitest';
import { buildSharePolicyPreviewTree } from './vfsSharePolicyPreviewTree.js';

describe('buildSharePolicyPreviewTree', () => {
  it('returns classified preview nodes with summary and cursor', async () => {
    const query = async <T>(text: string, values?: unknown[]) => {
      if (text.includes('FROM total') && text.includes('LEFT JOIN page')) {
        expect(values?.[0]).toBe('root-1');
        return {
          rows: [
            {
              item_id: 'root-1',
              object_type: 'contact',
              depth: 0,
              node_path: 'root-1',
              total_count: '3'
            },
            {
              item_id: 'wallet-1',
              object_type: 'walletItem',
              depth: 1,
              node_path: 'root-1/wallet-1',
              total_count: '3'
            },
            {
              item_id: 'workout-1',
              object_type: 'healthWorkoutEntry',
              depth: 1,
              node_path: 'root-1/workout-1',
              total_count: '3'
            }
          ] as T[]
        };
      }
      if (text.includes('FROM vfs_acl_entries')) {
        return {
          rows: [
            {
              id: 'share:share-root',
              item_id: 'root-1',
              access_level: 'read',
              revoked_at: null
            },
            {
              id: 'policy-compiled:user:target:wallet-1',
              item_id: 'wallet-1',
              access_level: 'write',
              revoked_at: null
            }
          ] as T[]
        };
      }
      if (text.includes('FROM vfs_acl_entry_provenance')) {
        return {
          rows: [
            {
              acl_entry_id: 'policy-compiled:user:target:wallet-1',
              policy_id: 'policy-a'
            },
            {
              acl_entry_id: 'policy-compiled:user:target:wallet-1',
              policy_id: 'policy-b'
            },
            {
              acl_entry_id: 'policy-compiled:user:target:wallet-1',
              policy_id: null
            }
          ] as T[]
        };
      }
      throw new Error(`Unexpected query in preview test: ${text}`);
    };

    const result = await buildSharePolicyPreviewTree(
      { query },
      {
        rootItemId: 'root-1',
        principalType: 'user',
        principalId: 'target-user',
        limit: 2,
        cursor: null,
        maxDepth: null,
        search: null,
        objectTypes: null
      }
    );

    expect(result.nextCursor).toBe('root-1/wallet-1');
    expect(result.nodes).toEqual([
      {
        itemId: 'root-1',
        objectType: 'contact',
        depth: 0,
        path: 'root-1',
        state: 'direct',
        effectiveAccessLevel: 'read',
        sourcePolicyIds: []
      },
      {
        itemId: 'wallet-1',
        objectType: 'walletItem',
        depth: 1,
        path: 'root-1/wallet-1',
        state: 'derived',
        effectiveAccessLevel: 'write',
        sourcePolicyIds: ['policy-a', 'policy-b']
      }
    ]);
    expect(result.summary).toEqual({
      totalMatchingNodes: 3,
      returnedNodes: 2,
      directCount: 1,
      derivedCount: 1,
      deniedCount: 0,
      includedCount: 2,
      excludedCount: 0
    });
  });

  it('returns excluded node counts when no acl entries match the principal', async () => {
    const query = async <T>(text: string) => {
      if (text.includes('FROM total') && text.includes('LEFT JOIN page')) {
        return {
          rows: [
            {
              item_id: 'root-1',
              object_type: 'contact',
              depth: 0,
              node_path: 'root-1',
              total_count: 1
            }
          ] as T[]
        };
      }
      if (text.includes('FROM vfs_acl_entries')) {
        return { rows: [] as T[] };
      }
      throw new Error(`Unexpected query in excluded preview test: ${text}`);
    };

    const result = await buildSharePolicyPreviewTree(
      { query },
      {
        rootItemId: 'root-1',
        principalType: 'user',
        principalId: 'target-user',
        limit: 10,
        cursor: null,
        maxDepth: null,
        search: null,
        objectTypes: null
      }
    );

    expect(result.nextCursor).toBeNull();
    expect(result.nodes).toEqual([
      {
        itemId: 'root-1',
        objectType: 'contact',
        depth: 0,
        path: 'root-1',
        state: 'excluded',
        effectiveAccessLevel: null,
        sourcePolicyIds: []
      }
    ]);
    expect(result.summary.excludedCount).toBe(1);
    expect(result.summary.totalMatchingNodes).toBe(1);
  });

  it('returns empty node pages when filters remove all tree nodes', async () => {
    const query = async <T>(text: string, values?: unknown[]) => {
      if (text.includes('FROM total') && text.includes('LEFT JOIN page')) {
        expect(values?.[2]).toBeNull();
        expect(values?.[3]).toEqual(['walletItem']);
        return {
          rows: [
            {
              item_id: null,
              object_type: null,
              depth: null,
              node_path: null,
              total_count: 0
            }
          ] as T[]
        };
      }
      throw new Error(`Unexpected query in empty preview test: ${text}`);
    };

    const result = await buildSharePolicyPreviewTree(
      { query },
      {
        rootItemId: 'root-1',
        principalType: 'user',
        principalId: 'target-user',
        limit: 5,
        cursor: null,
        maxDepth: null,
        search: '   ',
        objectTypes: ['', 'walletItem', 'walletItem']
      }
    );

    expect(result).toEqual({
      nodes: [],
      nextCursor: null,
      summary: {
        totalMatchingNodes: 0,
        returnedNodes: 0,
        directCount: 0,
        derivedCount: 0,
        deniedCount: 0,
        includedCount: 0,
        excludedCount: 0
      }
    });
  });

  it('classifies unknown acl ids as included state', async () => {
    const query = async <T>(text: string) => {
      if (text.includes('FROM total') && text.includes('LEFT JOIN page')) {
        return {
          rows: [
            {
              item_id: 'root-1',
              object_type: 'contact',
              depth: 0,
              node_path: 'root-1',
              total_count: 1
            }
          ] as T[]
        };
      }
      if (text.includes('FROM vfs_acl_entries')) {
        return {
          rows: [
            {
              id: 'custom-acl-id',
              item_id: 'root-1',
              access_level: 'read',
              revoked_at: null
            }
          ] as T[]
        };
      }
      if (text.includes('FROM vfs_acl_entry_provenance')) {
        return { rows: [] as T[] };
      }
      throw new Error(`Unexpected query in included preview test: ${text}`);
    };

    const result = await buildSharePolicyPreviewTree(
      { query },
      {
        rootItemId: 'root-1',
        principalType: 'user',
        principalId: 'target-user',
        limit: 10,
        cursor: null,
        maxDepth: null,
        search: null,
        objectTypes: null
      }
    );

    expect(result.nodes).toEqual([
      {
        itemId: 'root-1',
        objectType: 'contact',
        depth: 0,
        path: 'root-1',
        state: 'included',
        effectiveAccessLevel: 'read',
        sourcePolicyIds: []
      }
    ]);
    expect(result.summary.includedCount).toBe(1);
    expect(result.summary.directCount).toBe(0);
    expect(result.summary.derivedCount).toBe(0);
    expect(result.summary.deniedCount).toBe(0);
  });
});
