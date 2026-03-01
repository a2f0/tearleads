import { describe, expect, it, vi } from 'vitest';
import { repairVfsSharePolicyAclDrift } from './vfsSharePolicyDriftRepair.js';

function mockCompileResult() {
  return {
    compilerRunId: 'compile-run',
    policyCount: 2,
    activePolicyCount: 2,
    selectorCount: 3,
    principalCount: 2,
    expandedMatchCount: 6,
    decisionsCount: 4,
    touchedAclEntryCount: 4,
    staleRevocationCount: 1
  };
}

describe('repairVfsSharePolicyAclDrift', () => {
  it('runs apply mode with transactional compile by default', async () => {
    const query = vi.fn();
    const compile = vi.fn(async () => mockCompileResult());
    const now = new Date('2026-02-28T19:00:00.000Z');

    const result = await repairVfsSharePolicyAclDrift(
      { query },
      {
        now,
        compilerRunId: 'run-apply',
        actorId: 'system',
        lockKey: 'custom-lock',
        compile
      }
    );

    expect(result.mode).toBe('apply');
    expect(result.compileResult.compilerRunId).toBe('compile-run');
    expect(compile).toHaveBeenCalledTimes(1);
    expect(compile).toHaveBeenCalledWith(
      { query },
      {
        now,
        compilerRunId: 'run-apply',
        actorId: 'system',
        dryRun: false,
        transactional: true,
        lockKey: 'custom-lock'
      }
    );
  });

  it('runs dry-run mode without transactional writes', async () => {
    const query = vi.fn();
    const compile = vi.fn(async () => mockCompileResult());

    const result = await repairVfsSharePolicyAclDrift(
      { query },
      {
        dryRun: true,
        compile
      }
    );

    expect(result.mode).toBe('dryRun');
    expect(compile).toHaveBeenCalledWith(
      { query },
      {
        dryRun: true,
        transactional: false
      }
    );
  });
});
