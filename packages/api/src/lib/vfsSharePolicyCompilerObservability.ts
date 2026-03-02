interface VfsSharePolicyCompilerRunCounts {
  policyCount: number;
  activePolicyCount: number;
  selectorCount: number;
  principalCount: number;
  expandedMatchCount: number;
  decisionsCount: number;
  touchedAclEntryCount: number;
  staleRevocationCount: number;
}

interface VfsSharePolicyCompilerRunDurations {
  loadStateMs: number;
  compileCoreMs: number;
  materializeMs: number;
  staleRevocationMs: number;
  totalMs: number;
}

interface BuildVfsSharePolicyCompilerRunMetricInput {
  compilerRunId: string;
  success: boolean;
  dryRun: boolean;
  transactional: boolean;
  policyFilterCount: number;
  maxExpandedMatchCount: number;
  maxDecisionCount: number;
  lockTimeoutMs: number;
  statementTimeoutMs: number;
  counts: VfsSharePolicyCompilerRunCounts;
  durations: VfsSharePolicyCompilerRunDurations;
  error?: unknown;
  occurredAt?: Date;
}

interface VfsSharePolicyCompilerRunMetric {
  metricVersion: 1;
  event: 'vfs_share_policy_compile_run';
  occurredAt: string;
  success: boolean;
  error: string | null;
  compilerRunId: string;
  dryRun: boolean;
  transactional: boolean;
  policyFilterCount: number;
  maxExpandedMatchCount: number;
  maxDecisionCount: number;
  lockTimeoutMs: number;
  statementTimeoutMs: number;
  policyCount: number;
  activePolicyCount: number;
  selectorCount: number;
  principalCount: number;
  expandedMatchCount: number;
  decisionsCount: number;
  touchedAclEntryCount: number;
  staleRevocationCount: number;
  loadStateMs: number;
  compileCoreMs: number;
  materializeMs: number;
  staleRevocationMs: number;
  totalMs: number;
}

function normalizeErrorMessage(error: unknown): string | null {
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === 'string') {
    return error;
  }
  return null;
}

export function buildVfsSharePolicyCompilerRunMetric(
  input: BuildVfsSharePolicyCompilerRunMetricInput
): VfsSharePolicyCompilerRunMetric {
  const occurredAt = (input.occurredAt ?? new Date()).toISOString();
  return {
    metricVersion: 1,
    event: 'vfs_share_policy_compile_run',
    occurredAt,
    success: input.success,
    error: normalizeErrorMessage(input.error),
    compilerRunId: input.compilerRunId,
    dryRun: input.dryRun,
    transactional: input.transactional,
    policyFilterCount: Math.max(0, Math.trunc(input.policyFilterCount)),
    maxExpandedMatchCount: Math.max(0, Math.trunc(input.maxExpandedMatchCount)),
    maxDecisionCount: Math.max(0, Math.trunc(input.maxDecisionCount)),
    lockTimeoutMs: Math.max(0, Math.trunc(input.lockTimeoutMs)),
    statementTimeoutMs: Math.max(0, Math.trunc(input.statementTimeoutMs)),
    policyCount: Math.max(0, Math.trunc(input.counts.policyCount)),
    activePolicyCount: Math.max(0, Math.trunc(input.counts.activePolicyCount)),
    selectorCount: Math.max(0, Math.trunc(input.counts.selectorCount)),
    principalCount: Math.max(0, Math.trunc(input.counts.principalCount)),
    expandedMatchCount: Math.max(0, Math.trunc(input.counts.expandedMatchCount)),
    decisionsCount: Math.max(0, Math.trunc(input.counts.decisionsCount)),
    touchedAclEntryCount: Math.max(0, Math.trunc(input.counts.touchedAclEntryCount)),
    staleRevocationCount: Math.max(0, Math.trunc(input.counts.staleRevocationCount)),
    loadStateMs: Math.max(0, Math.trunc(input.durations.loadStateMs)),
    compileCoreMs: Math.max(0, Math.trunc(input.durations.compileCoreMs)),
    materializeMs: Math.max(0, Math.trunc(input.durations.materializeMs)),
    staleRevocationMs: Math.max(0, Math.trunc(input.durations.staleRevocationMs)),
    totalMs: Math.max(0, Math.trunc(input.durations.totalMs))
  };
}

export function emitVfsSharePolicyCompilerRunMetric(
  metric: VfsSharePolicyCompilerRunMetric
): void {
  console.info(JSON.stringify(metric));
}

export function shouldEmitVfsSharePolicyCompilerMetrics(
  providedValue: boolean | undefined
): boolean {
  if (providedValue !== undefined) {
    return providedValue;
  }

  const envRawValue = process.env['VFS_SHARE_POLICY_COMPILER_EMIT_METRICS'];
  if (envRawValue === undefined || envRawValue.trim().length === 0) {
    return process.env['NODE_ENV'] !== 'test';
  }

  const normalized = envRawValue.trim().toLowerCase();
  if (normalized === '1' || normalized === 'true') {
    return true;
  }
  if (normalized === '0' || normalized === 'false') {
    return false;
  }
  throw new Error(
    'VFS_SHARE_POLICY_COMPILER_EMIT_METRICS must be one of: true, false, 1, 0'
  );
}
