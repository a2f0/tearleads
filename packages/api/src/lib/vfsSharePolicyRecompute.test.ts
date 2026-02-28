import { describe, expect, it, vi } from 'vitest';
import {
  resolveImpactedSharePolicyIds,
  runIncrementalSharePolicyRecompute
} from './vfsSharePolicyRecompute.js';

interface QueryCall {
  text: string;
  values?: unknown[] | undefined;
}

function normalizeSql(text: string): string {
  return text.replace(/\s+/gu, ' ').trim();
}

describe('resolveImpactedSharePolicyIds', () => {
  it('returns normalized id for policy trigger without querying', async () => {
    const calls: QueryCall[] = [];
    const query = async <T>(text: string, values?: unknown[]) => {
      calls.push({ text: normalizeSql(text), values });
      return { rows: [] as T[] };
    };

    const impactedPolicyIds = await resolveImpactedSharePolicyIds(
      { query },
      {
        kind: 'policy',
        policyId: '  policy-a  '
      },
      new Date('2026-02-28T18:00:00.000Z')
    );

    expect(impactedPolicyIds).toEqual(['policy-a']);
    expect(calls).toHaveLength(0);
  });

  it('returns empty when metadata trigger normalizes to no item ids', async () => {
    const calls: QueryCall[] = [];
    const query = async <T>(text: string, values?: unknown[]) => {
      calls.push({ text: normalizeSql(text), values });
      return { rows: [] as T[] };
    };

    const impactedPolicyIds = await resolveImpactedSharePolicyIds(
      { query },
      {
        kind: 'metadata',
        itemId: '   '
      },
      new Date('2026-02-28T18:00:00.000Z')
    );

    expect(impactedPolicyIds).toEqual([]);
    expect(calls).toHaveLength(0);
  });

  it('resolves impacted active policies for metadata changes', async () => {
    const calls: QueryCall[] = [];
    const now = new Date('2026-02-28T18:00:00.000Z');
    const query = async <T>(text: string, values?: unknown[]) => {
      calls.push({ text: normalizeSql(text), values });
      return {
        rows: [
          { policy_id: 'policy-b' },
          { policy_id: 'policy-a' },
          { policy_id: 'policy-b' }
        ] as T[]
      };
    };

    const impactedPolicyIds = await resolveImpactedSharePolicyIds(
      { query },
      {
        kind: 'metadata',
        itemId: 'item-1'
      },
      now
    );

    expect(impactedPolicyIds).toEqual(['policy-a', 'policy-b']);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.text).toContain('WITH RECURSIVE policy_scope');
    expect(calls[0]?.values).toEqual([['item-1'], now]);
  });

  it('uses parent and child ids when recomputing link changes', async () => {
    const calls: QueryCall[] = [];
    const now = new Date('2026-02-28T18:00:00.000Z');
    const query = async <T>(text: string, values?: unknown[]) => {
      calls.push({ text: normalizeSql(text), values });
      return { rows: [] as T[] };
    };

    const impactedPolicyIds = await resolveImpactedSharePolicyIds(
      { query },
      {
        kind: 'link',
        parentId: 'contact-1',
        childId: 'wallet-1'
      },
      now
    );

    expect(impactedPolicyIds).toEqual([]);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.values).toEqual([['contact-1', 'wallet-1'], now]);
  });
});

describe('runIncrementalSharePolicyRecompute', () => {
  it('skips compile when no impacted policies are found', async () => {
    const query = async <T>() => ({ rows: [] as T[] });
    const compile = vi.fn();

    const result = await runIncrementalSharePolicyRecompute(
      { query },
      {
        kind: 'metadata',
        itemId: 'item-1'
      },
      {
        now: new Date('2026-02-28T18:00:00.000Z'),
        compile
      }
    );

    expect(result).toEqual({
      impactedPolicyIds: [],
      compileResult: null
    });
    expect(compile).not.toHaveBeenCalled();
  });

  it('runs scoped compile with normalized impacted policy ids', async () => {
    const query = async <T>() => {
      return {
        rows: [
          { policy_id: 'policy-z' },
          { policy_id: 'policy-a' },
          { policy_id: 'policy-z' }
        ] as T[]
      };
    };
    const compile = vi.fn(async () => ({
      compilerRunId: 'compile-run',
      policyCount: 2,
      activePolicyCount: 2,
      selectorCount: 3,
      principalCount: 1,
      expandedMatchCount: 4,
      decisionsCount: 2,
      touchedAclEntryCount: 2,
      staleRevocationCount: 0
    }));
    const now = new Date('2026-02-28T18:00:00.000Z');

    const result = await runIncrementalSharePolicyRecompute(
      { query },
      {
        kind: 'link',
        parentId: 'contact-1',
        childId: 'wallet-1'
      },
      {
        now,
        compilerRunId: 'run-1',
        actorId: 'system',
        dryRun: true,
        compile
      }
    );

    expect(result.impactedPolicyIds).toEqual(['policy-a', 'policy-z']);
    expect(result.compileResult?.compilerRunId).toBe('compile-run');
    expect(compile).toHaveBeenCalledTimes(1);
    expect(compile).toHaveBeenCalledWith(
      { query },
      {
        now,
        compilerRunId: 'run-1',
        actorId: 'system',
        dryRun: true,
        policyIds: ['policy-a', 'policy-z']
      }
    );
  });

  it('falls back to default compiler options when overrides are omitted', async () => {
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
        return { rows: [] as T[] };
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
      throw new Error(
        `Unexpected query in default compile fallback test: ${text}`
      );
    };

    const result = await runIncrementalSharePolicyRecompute(
      { query },
      {
        kind: 'policy',
        policyId: ' policy-a '
      }
    );

    expect(result.impactedPolicyIds).toEqual(['policy-a']);
    expect(result.compileResult?.policyCount).toBe(1);
    expect(result.compileResult?.decisionsCount).toBe(0);

    const lockQuery = calls.find((call) =>
      call.text.includes('SELECT pg_advisory_xact_lock')
    );
    expect(lockQuery?.values).toEqual(['vfs_share_policy_compile:policy-a']);
  });
});
