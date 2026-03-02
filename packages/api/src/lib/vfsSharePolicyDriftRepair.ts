import {
  type CompileVfsSharePoliciesOptions,
  type CompileVfsSharePoliciesResult,
  compileVfsSharePolicies
} from './vfsSharePolicyCompiler.js';
import type { PgQueryable } from './vfsSharePolicyCompilerState.js';

type CompileSharePoliciesFn = (
  client: PgQueryable,
  options: CompileVfsSharePoliciesOptions
) => Promise<CompileVfsSharePoliciesResult>;

interface RepairVfsSharePolicyAclDriftOptions
  extends Omit<CompileVfsSharePoliciesOptions, 'policyIds' | 'transactional'> {
  compile?: CompileSharePoliciesFn;
}

export interface RepairVfsSharePolicyAclDriftResult {
  mode: 'dryRun' | 'apply';
  compileResult: CompileVfsSharePoliciesResult;
}

export async function repairVfsSharePolicyAclDrift(
  client: PgQueryable,
  options: RepairVfsSharePolicyAclDriftOptions = {}
): Promise<RepairVfsSharePolicyAclDriftResult> {
  const dryRun = options.dryRun ?? false;
  const compileFn = options.compile ?? compileVfsSharePolicies;
  const compileOptions: CompileVfsSharePoliciesOptions = {
    dryRun,
    transactional: !dryRun
  };
  if (options.now !== undefined) {
    compileOptions.now = options.now;
  }
  if (options.compilerRunId !== undefined) {
    compileOptions.compilerRunId = options.compilerRunId;
  }
  if (options.actorId !== undefined) {
    compileOptions.actorId = options.actorId;
  }
  if (options.lockKey !== undefined) {
    compileOptions.lockKey = options.lockKey;
  }
  if (options.maxExpandedMatchCount !== undefined) {
    compileOptions.maxExpandedMatchCount = options.maxExpandedMatchCount;
  }
  if (options.maxDecisionCount !== undefined) {
    compileOptions.maxDecisionCount = options.maxDecisionCount;
  }
  if (options.lockTimeoutMs !== undefined) {
    compileOptions.lockTimeoutMs = options.lockTimeoutMs;
  }
  if (options.statementTimeoutMs !== undefined) {
    compileOptions.statementTimeoutMs = options.statementTimeoutMs;
  }
  if (options.emitMetrics !== undefined) {
    compileOptions.emitMetrics = options.emitMetrics;
  }
  if (options.onMetrics !== undefined) {
    compileOptions.onMetrics = options.onMetrics;
  }

  const compileResult = await compileFn(client, compileOptions);
  return {
    mode: dryRun ? 'dryRun' : 'apply',
    compileResult
  };
}
