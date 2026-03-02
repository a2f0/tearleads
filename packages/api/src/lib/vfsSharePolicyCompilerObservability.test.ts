import { describe, expect, it, vi } from 'vitest';
import {
  buildVfsSharePolicyCompilerRunMetric,
  emitVfsSharePolicyCompilerRunMetric,
  shouldEmitVfsSharePolicyCompilerMetrics
} from './vfsSharePolicyCompilerObservability.js';

describe('vfsSharePolicyCompilerObservability', () => {
  it('builds normalized run metrics', () => {
    const metric = buildVfsSharePolicyCompilerRunMetric({
      compilerRunId: 'run-1',
      success: true,
      dryRun: false,
      transactional: true,
      policyFilterCount: 2.9,
      maxExpandedMatchCount: 1000.9,
      maxDecisionCount: 500.1,
      lockTimeoutMs: 4000.9,
      statementTimeoutMs: 120000.2,
      counts: {
        policyCount: 3.2,
        activePolicyCount: 2.9,
        selectorCount: 10.6,
        principalCount: 8.4,
        expandedMatchCount: 300.9,
        decisionsCount: 250.7,
        touchedAclEntryCount: 125.3,
        staleRevocationCount: 12.8
      },
      durations: {
        loadStateMs: 8.6,
        compileCoreMs: 25.2,
        materializeMs: 40.9,
        staleRevocationMs: 6.8,
        totalMs: 81.5
      },
      occurredAt: new Date('2026-03-02T10:00:00.000Z')
    });

    expect(metric).toEqual({
      metricVersion: 1,
      event: 'vfs_share_policy_compile_run',
      occurredAt: '2026-03-02T10:00:00.000Z',
      success: true,
      error: null,
      compilerRunId: 'run-1',
      dryRun: false,
      transactional: true,
      policyFilterCount: 2,
      maxExpandedMatchCount: 1000,
      maxDecisionCount: 500,
      lockTimeoutMs: 4000,
      statementTimeoutMs: 120000,
      policyCount: 3,
      activePolicyCount: 2,
      selectorCount: 10,
      principalCount: 8,
      expandedMatchCount: 300,
      decisionsCount: 250,
      touchedAclEntryCount: 125,
      staleRevocationCount: 12,
      loadStateMs: 8,
      compileCoreMs: 25,
      materializeMs: 40,
      staleRevocationMs: 6,
      totalMs: 81
    });
  });

  it('normalizes failed run error metadata', () => {
    const metric = buildVfsSharePolicyCompilerRunMetric({
      compilerRunId: 'run-err',
      success: false,
      dryRun: true,
      transactional: false,
      policyFilterCount: -1,
      maxExpandedMatchCount: -1,
      maxDecisionCount: -1,
      lockTimeoutMs: -1,
      statementTimeoutMs: -1,
      counts: {
        policyCount: -1,
        activePolicyCount: -1,
        selectorCount: -1,
        principalCount: -1,
        expandedMatchCount: -1,
        decisionsCount: -1,
        touchedAclEntryCount: -1,
        staleRevocationCount: -1
      },
      durations: {
        loadStateMs: -1,
        compileCoreMs: -1,
        materializeMs: -1,
        staleRevocationMs: -1,
        totalMs: -1
      },
      error: new Error('compiler failed')
    });

    expect(metric.success).toBe(false);
    expect(metric.error).toBe('compiler failed');
    expect(metric.totalMs).toBe(0);
    expect(metric.policyCount).toBe(0);
    expect(metric.maxDecisionCount).toBe(0);
  });

  it('emits serialized metric payload', () => {
    const spy = vi.spyOn(console, 'info').mockImplementation(() => {});
    const metric = buildVfsSharePolicyCompilerRunMetric({
      compilerRunId: 'run-log',
      success: true,
      dryRun: true,
      transactional: false,
      policyFilterCount: 0,
      maxExpandedMatchCount: 500000,
      maxDecisionCount: 250000,
      lockTimeoutMs: 5000,
      statementTimeoutMs: 120000,
      counts: {
        policyCount: 0,
        activePolicyCount: 0,
        selectorCount: 0,
        principalCount: 0,
        expandedMatchCount: 0,
        decisionsCount: 0,
        touchedAclEntryCount: 0,
        staleRevocationCount: 0
      },
      durations: {
        loadStateMs: 0,
        compileCoreMs: 0,
        materializeMs: 0,
        staleRevocationMs: 0,
        totalMs: 0
      }
    });

    emitVfsSharePolicyCompilerRunMetric(metric);

    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0]?.[0]).toContain(
      '"event":"vfs_share_policy_compile_run"'
    );
    spy.mockRestore();
  });

  it('resolves emit settings from options and env', () => {
    const originalEnvValue =
      process.env['VFS_SHARE_POLICY_COMPILER_EMIT_METRICS'];
    const originalNodeEnv = process.env['NODE_ENV'];
    try {
      process.env['NODE_ENV'] = 'test';
      delete process.env['VFS_SHARE_POLICY_COMPILER_EMIT_METRICS'];
      expect(shouldEmitVfsSharePolicyCompilerMetrics(undefined)).toBe(false);

      process.env['VFS_SHARE_POLICY_COMPILER_EMIT_METRICS'] = 'true';
      expect(shouldEmitVfsSharePolicyCompilerMetrics(undefined)).toBe(true);

      process.env['VFS_SHARE_POLICY_COMPILER_EMIT_METRICS'] = '0';
      expect(shouldEmitVfsSharePolicyCompilerMetrics(undefined)).toBe(false);

      process.env['VFS_SHARE_POLICY_COMPILER_EMIT_METRICS'] = 'sometimes';
      expect(() => shouldEmitVfsSharePolicyCompilerMetrics(undefined)).toThrow(
        'VFS_SHARE_POLICY_COMPILER_EMIT_METRICS must be one of: true, false, 1, 0'
      );

      expect(shouldEmitVfsSharePolicyCompilerMetrics(true)).toBe(true);
      expect(shouldEmitVfsSharePolicyCompilerMetrics(false)).toBe(false);
    } finally {
      if (originalEnvValue === undefined) {
        delete process.env['VFS_SHARE_POLICY_COMPILER_EMIT_METRICS'];
      } else {
        process.env['VFS_SHARE_POLICY_COMPILER_EMIT_METRICS'] =
          originalEnvValue;
      }
      if (originalNodeEnv === undefined) {
        delete process.env['NODE_ENV'];
      } else {
        process.env['NODE_ENV'] = originalNodeEnv;
      }
    }
  });
});
