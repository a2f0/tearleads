import { describe, expect, it, vi } from 'vitest';
import {
  type CompileVfsSharePoliciesMetrics,
  compileVfsSharePolicies
} from './vfsSharePolicyCompiler.js';

interface QueryCall {
  text: string;
  values: unknown[] | undefined;
}

function normalizeSql(text: string): string {
  return text.replace(/\s+/gu, ' ').trim();
}

function createSingleDecisionQuery(calls: QueryCall[]) {
  return async <T>(text: string, values?: unknown[]) => {
    calls.push({ text: normalizeSql(text), values });
    if (text === 'BEGIN' || text === 'COMMIT' || text === 'ROLLBACK') {
      return { rows: [] as T[] };
    }
    if (
      text.includes('SET LOCAL lock_timeout') ||
      text.includes('SET LOCAL statement_timeout')
    ) {
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
    if (
      text.includes('WITH RECURSIVE reachable') &&
      text.includes('FROM vfs_links')
    ) {
      return {
        rows: [{ parent_id: 'root-1', child_id: 'item-1' }] as T[]
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
    if (text.includes('INSERT INTO vfs_acl_entries')) {
      return { rows: [{ id: 'policy-compiled:user:alice:item-1' }] as T[] };
    }
    if (text.includes('INSERT INTO vfs_acl_entry_provenance')) {
      return { rows: [] as T[] };
    }
    if (
      text.includes('SELECT DISTINCT acl_entry_id') &&
      text.includes('FROM vfs_acl_entry_provenance')
    ) {
      return { rows: [] as T[] };
    }
    if (text.includes('UPDATE vfs_acl_entries')) {
      return { rows: [] as T[] };
    }
    if (text.includes('UPDATE vfs_acl_entry_provenance')) {
      return { rows: [] as T[] };
    }
    throw new Error(`Unexpected query in guardrail test: ${text}`);
  };
}

describe('compileVfsSharePolicies guardrails and metrics', () => {
  it('emits compile metrics on successful runs', async () => {
    const calls: QueryCall[] = [];
    const query = createSingleDecisionQuery(calls);
    const metricsRef: { current: CompileVfsSharePoliciesMetrics | null } = {
      current: null
    };

    const result = await compileVfsSharePolicies(
      { query },
      {
        now: new Date('2026-03-01T00:00:00.000Z'),
        compilerRunId: 'run-metrics',
        dryRun: true,
        onMetrics: (nextMetrics) => {
          metricsRef.current = nextMetrics;
        }
      }
    );

    expect(result.compilerRunId).toBe('run-metrics');
    expect(result.decisionsCount).toBe(1);
    const metrics = metricsRef.current;
    if (!metrics) {
      throw new Error('Expected compile metrics callback to be invoked');
    }
    expect(metrics.compilerRunId).toBe('run-metrics');
    expect(metrics.decisionsCount).toBe(1);
    expect(metrics.expandedMatchCount).toBe(1);
    expect(metrics.dryRun).toBe(true);
    expect(metrics.loadStateMs).toBeGreaterThanOrEqual(0);
    expect(metrics.compileCoreMs).toBeGreaterThanOrEqual(0);
    expect(metrics.materializeMs).toBe(0);
    expect(metrics.staleRevocationMs).toBe(0);
    expect(metrics.totalMs).toBeGreaterThanOrEqual(
      metrics.loadStateMs + metrics.compileCoreMs
    );
    expect(
      calls.some((call) => call.text.includes('INSERT INTO vfs_acl_entries'))
    ).toBe(false);
  });

  it('throws when expanded-match guardrail is exceeded', async () => {
    const calls: QueryCall[] = [];
    const query = createSingleDecisionQuery(calls);

    await expect(
      compileVfsSharePolicies(
        { query },
        {
          now: new Date('2026-03-01T00:00:00.000Z'),
          compilerRunId: 'run-expanded-guardrail',
          dryRun: true,
          maxExpandedMatchCount: 0
        }
      )
    ).rejects.toThrow('expandedMatchCount');

    expect(
      calls.some((call) => call.text.includes('INSERT INTO vfs_acl_entries'))
    ).toBe(false);
  });

  it('throws when decision-count guardrail is exceeded', async () => {
    const calls: QueryCall[] = [];
    const query = createSingleDecisionQuery(calls);

    await expect(
      compileVfsSharePolicies(
        { query },
        {
          now: new Date('2026-03-01T00:00:00.000Z'),
          compilerRunId: 'run-decision-guardrail',
          dryRun: true,
          maxDecisionCount: 0
        }
      )
    ).rejects.toThrow('maxDecisionCount');

    expect(
      calls.some((call) => call.text.includes('INSERT INTO vfs_acl_entries'))
    ).toBe(false);
  });

  it('rejects invalid guardrail configuration', async () => {
    const calls: QueryCall[] = [];
    const query = createSingleDecisionQuery(calls);

    await expect(
      compileVfsSharePolicies(
        { query },
        {
          now: new Date('2026-03-01T00:00:00.000Z'),
          maxExpandedMatchCount: -1
        }
      )
    ).rejects.toThrow(
      'maxExpandedMatchCount must be a non-negative finite number'
    );

    expect(calls).toHaveLength(0);
  });

  it('uses environment guardrail limits when overrides are omitted', async () => {
    const previousValue =
      process.env['VFS_SHARE_POLICY_COMPILER_MAX_DECISION_COUNT'];
    process.env['VFS_SHARE_POLICY_COMPILER_MAX_DECISION_COUNT'] = '0';
    try {
      const calls: QueryCall[] = [];
      const query = createSingleDecisionQuery(calls);

      await expect(
        compileVfsSharePolicies(
          { query },
          {
            now: new Date('2026-03-01T00:00:00.000Z'),
            compilerRunId: 'run-env-guardrail',
            dryRun: true
          }
        )
      ).rejects.toThrow('maxDecisionCount');
    } finally {
      if (previousValue === undefined) {
        delete process.env['VFS_SHARE_POLICY_COMPILER_MAX_DECISION_COUNT'];
      } else {
        process.env['VFS_SHARE_POLICY_COMPILER_MAX_DECISION_COUNT'] =
          previousValue;
      }
    }
  });

  it('emits structured run telemetry when explicitly enabled', async () => {
    const calls: QueryCall[] = [];
    const query = createSingleDecisionQuery(calls);
    const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});

    try {
      await compileVfsSharePolicies(
        { query },
        {
          now: new Date('2026-03-01T00:00:00.000Z'),
          compilerRunId: 'run-telemetry',
          dryRun: true,
          emitMetrics: true
        }
      );

      expect(infoSpy).toHaveBeenCalledTimes(1);
      const payload = infoSpy.mock.calls[0]?.[0];
      expect(payload).toContain('"event":"vfs_share_policy_compile_run"');
      expect(payload).toContain('"compilerRunId":"run-telemetry"');
      expect(payload).toContain('"success":true');
    } finally {
      infoSpy.mockRestore();
    }
  });
});
