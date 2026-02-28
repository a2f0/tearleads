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

interface RepairVfsSharePolicyAclDriftOptions {
  now?: Date;
  compilerRunId?: string;
  actorId?: string | null;
  dryRun?: boolean;
  lockKey?: string;
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

  const compileResult = await compileFn(client, compileOptions);
  return {
    mode: dryRun ? 'dryRun' : 'apply',
    compileResult
  };
}
