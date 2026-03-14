import { describe, expect, it } from 'vitest';
import { compileVfsSharePolicies } from './vfsSharePolicyCompiler.js';

interface QueryCall {
  text: string;
  values: unknown[] | undefined;
}

function normalizeSql(text: string): string {
  return text.replace(/\s+/gu, ' ').trim();
}

function createConcurrentCompileQueryHarness() {
  const calls: QueryCall[] = [];
  let lockHeld = false;
  const lockWaiters: Array<() => void> = [];

  let releaseFirstPolicyQuery: (() => void) | null = null;
  const firstPolicyQueryGate = new Promise<void>((resolve) => {
    releaseFirstPolicyQuery = resolve;
  });
  let firstPolicyQueryBlocked = false;

  const query = async <T>(text: string, values?: unknown[]) => {
    calls.push({ text: normalizeSql(text), values });

    if (text === 'BEGIN' || text === 'ROLLBACK') {
      return { rows: [] as T[] };
    }
    if (text === 'COMMIT') {
      lockHeld = false;
      const waiter = lockWaiters.shift();
      if (waiter) {
        waiter();
      }
      return { rows: [] as T[] };
    }
    if (
      text.includes('SET LOCAL lock_timeout') ||
      text.includes('SET LOCAL statement_timeout')
    ) {
      return { rows: [] as T[] };
    }
    if (text.includes('SELECT pg_advisory_xact_lock')) {
      if (!lockHeld) {
        lockHeld = true;
        return { rows: [] as T[] };
      }
      await new Promise<void>((resolve) => {
        lockWaiters.push(resolve);
      });
      lockHeld = true;
      return { rows: [] as T[] };
    }
    if (text.includes('FROM vfs_share_policies')) {
      if (!firstPolicyQueryBlocked) {
        firstPolicyQueryBlocked = true;
        await firstPolicyQueryGate;
      }
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
        rows: [{ id: 'root-1', object_type: 'contactGroup' }] as T[]
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

    throw new Error(`Unexpected query in concurrency test: ${text}`);
  };

  return {
    query,
    calls,
    releaseFirstPolicyQuery: () => {
      if (!releaseFirstPolicyQuery) {
        throw new Error('Missing first-policy release handle');
      }
      releaseFirstPolicyQuery();
    }
  };
}

describe('compileVfsSharePolicies concurrency', () => {
  it('serializes concurrent transactional compiles via advisory locking', async () => {
    const harness = createConcurrentCompileQueryHarness();
    const now = new Date('2026-03-02T00:00:00.000Z');

    const firstRun = compileVfsSharePolicies(
      { query: harness.query },
      {
        now,
        compilerRunId: 'run-1'
      }
    );

    await new Promise<void>((resolve) => setTimeout(resolve, 0));

    const secondRun = compileVfsSharePolicies(
      { query: harness.query },
      {
        now,
        compilerRunId: 'run-2'
      }
    );

    await new Promise<void>((resolve) => setTimeout(resolve, 0));

    expect(
      harness.calls.filter((call) =>
        call.text.includes('SELECT pg_advisory_xact_lock')
      )
    ).toHaveLength(2);
    expect(
      harness.calls.filter((call) =>
        call.text.includes('FROM vfs_share_policies')
      )
    ).toHaveLength(1);

    harness.releaseFirstPolicyQuery();

    const [firstResult, secondResult] = await Promise.all([
      firstRun,
      secondRun
    ]);
    expect(firstResult.compilerRunId).toBe('run-1');
    expect(secondResult.compilerRunId).toBe('run-2');

    const policyQueryIndexes = harness.calls
      .map((call, index) =>
        call.text.includes('FROM vfs_share_policies') ? index : -1
      )
      .filter((index) => index >= 0);
    const commitIndexes = harness.calls
      .map((call, index) => (call.text === 'COMMIT' ? index : -1))
      .filter((index) => index >= 0);

    expect(policyQueryIndexes).toHaveLength(2);
    expect(commitIndexes).toHaveLength(2);
    expect(policyQueryIndexes[1]).toBeGreaterThan(commitIndexes[0] ?? -1);
  });
});
