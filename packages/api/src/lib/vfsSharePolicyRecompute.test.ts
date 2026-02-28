import { describe, expect, it, vi } from 'vitest';
import {
  resolveImpactedSharePolicyIds,
  runIncrementalSharePolicyRecompute
} from './vfsSharePolicyRecompute.js';

interface QueryCall {
  text: string;
  values?: unknown[];
}

function normalizeSql(text: string): string {
  return text.replace(/\s+/gu, ' ').trim();
}

describe('resolveImpactedSharePolicyIds', () => {
  it('returns normalized id for policy trigger without querying', async () => {
    const query = vi.fn(async <T>() => ({ rows: [] as T[] }));

    const impactedPolicyIds = await resolveImpactedSharePolicyIds(
      { query },
      {
        kind: 'policy',
        policyId: '  policy-a  '
      },
      new Date('2026-02-28T18:00:00.000Z')
    );

    expect(impactedPolicyIds).toEqual(['policy-a']);
    expect(query).not.toHaveBeenCalled();
  });

  it('resolves impacted active policies for metadata changes', async () => {
    const calls: QueryCall[] = [];
    const now = new Date('2026-02-28T18:00:00.000Z');
    const query = vi.fn(async <T>(text: string, values?: unknown[]) => {
      calls.push({ text: normalizeSql(text), values });
      return {
        rows: [
          { policy_id: 'policy-b' },
          { policy_id: 'policy-a' },
          { policy_id: 'policy-b' }
        ] as T[]
      };
    });

    const impactedPolicyIds = await resolveImpactedSharePolicyIds(
      { query },
      {
        kind: 'metadata',
        itemId: 'item-1'
      },
      now
    );

    expect(impactedPolicyIds).toEqual(['policy-a', 'policy-b']);
    expect(query).toHaveBeenCalledTimes(1);
    expect(calls[0]?.text).toContain('WITH RECURSIVE policy_scope');
    expect(calls[0]?.values).toEqual([['item-1'], now]);
  });

  it('uses parent and child ids when recomputing link changes', async () => {
    const calls: QueryCall[] = [];
    const now = new Date('2026-02-28T18:00:00.000Z');
    const query = vi.fn(async <T>(text: string, values?: unknown[]) => {
      calls.push({ text: normalizeSql(text), values });
      return { rows: [] as T[] };
    });

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
    expect(query).toHaveBeenCalledTimes(1);
    expect(calls[0]?.values).toEqual([['contact-1', 'wallet-1'], now]);
  });
});

describe('runIncrementalSharePolicyRecompute', () => {
  it('skips compile when no impacted policies are found', async () => {
    const query = vi.fn(async <T>() => ({ rows: [] as T[] }));
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
    const query = vi.fn(async <T>() => {
      return {
        rows: [
          { policy_id: 'policy-z' },
          { policy_id: 'policy-a' },
          { policy_id: 'policy-z' }
        ] as T[]
      };
    });
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
});
