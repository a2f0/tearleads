import { compileSharePolicyCore } from './vfsSharePolicyCompilerCore.js';
import { materializeCompiledDecisions } from './vfsSharePolicyCompilerMaterialization.js';
import {
  buildVfsSharePolicyCompilerRunMetric,
  emitVfsSharePolicyCompilerRunMetric,
  shouldEmitVfsSharePolicyCompilerMetrics
} from './vfsSharePolicyCompilerObservability.js';
import {
  buildCompileLockKey,
  loadSharePolicyState,
  normalizePolicyIds,
  type PgQueryable
} from './vfsSharePolicyCompilerState.js';

interface DerivedAclRow {
  acl_entry_id: string;
}

const DEFAULT_MAX_EXPANDED_MATCH_COUNT = 500_000;
const DEFAULT_MAX_DECISION_COUNT = 250_000;
const DEFAULT_LOCK_TIMEOUT_MS = 5_000;
const DEFAULT_STATEMENT_TIMEOUT_MS = 120_000;

function createCompilerRunId(now: Date): string {
  return `policy-compile:${now.toISOString()}:${crypto.randomUUID()}`;
}

function normalizeGuardrailLimit(
  value: number | undefined,
  fallback: number,
  optionName: string
): number {
  const resolved = value ?? fallback;
  if (!Number.isFinite(resolved) || resolved < 0) {
    throw new Error(`${optionName} must be a non-negative finite number`);
  }
  return Math.floor(resolved);
}

function parseNonNegativeIntegerEnv(
  envName: string,
  optionName: string
): number | undefined {
  const rawValue = process.env[envName];
  if (rawValue === undefined || rawValue.trim().length === 0) {
    return undefined;
  }
  const parsedValue = Number(rawValue);
  if (!Number.isFinite(parsedValue) || parsedValue < 0) {
    throw new Error(
      `${envName} must be a non-negative finite number for ${optionName}`
    );
  }
  return Math.floor(parsedValue);
}

function resolveLimitWithEnv(input: {
  provided: number | undefined;
  envName: string;
  fallback: number;
  optionName: string;
}): number {
  const envValue = parseNonNegativeIntegerEnv(input.envName, input.optionName);
  const resolvedValue = input.provided ?? envValue;
  return normalizeGuardrailLimit(
    resolvedValue,
    input.fallback,
    input.optionName
  );
}

export interface CompileVfsSharePoliciesOptions {
  now?: Date;
  compilerRunId?: string;
  actorId?: string | null;
  dryRun?: boolean;
  policyIds?: string[];
  transactional?: boolean;
  lockKey?: string;
  maxExpandedMatchCount?: number;
  maxDecisionCount?: number;
  lockTimeoutMs?: number;
  statementTimeoutMs?: number;
  emitMetrics?: boolean;
  onMetrics?: (metrics: CompileVfsSharePoliciesMetrics) => void;
}

export interface CompileVfsSharePoliciesResult {
  compilerRunId: string;
  policyCount: number;
  activePolicyCount: number;
  selectorCount: number;
  principalCount: number;
  expandedMatchCount: number;
  decisionsCount: number;
  touchedAclEntryCount: number;
  staleRevocationCount: number;
}

export interface CompileVfsSharePoliciesMetrics
  extends CompileVfsSharePoliciesResult {
  dryRun: boolean;
  transactional: boolean;
  loadStateMs: number;
  compileCoreMs: number;
  materializeMs: number;
  staleRevocationMs: number;
  totalMs: number;
}

export async function compileVfsSharePolicies(
  client: PgQueryable,
  options: CompileVfsSharePoliciesOptions = {}
): Promise<CompileVfsSharePoliciesResult> {
  const startedAtMs = Date.now();
  const now = options.now ?? new Date();
  const compilerRunId = options.compilerRunId ?? createCompilerRunId(now);
  const actorId = options.actorId ?? null;
  const dryRun = options.dryRun ?? false;
  const transactional = options.transactional ?? !dryRun;
  const policyIds = normalizePolicyIds(options.policyIds);
  if (policyIds && policyIds.length === 0) {
    return {
      compilerRunId,
      policyCount: 0,
      activePolicyCount: 0,
      selectorCount: 0,
      principalCount: 0,
      expandedMatchCount: 0,
      decisionsCount: 0,
      touchedAclEntryCount: 0,
      staleRevocationCount: 0
    };
  }
  const maxExpandedMatchCount = resolveLimitWithEnv({
    provided: options.maxExpandedMatchCount,
    envName: 'VFS_SHARE_POLICY_COMPILER_MAX_EXPANDED_MATCH_COUNT',
    fallback: DEFAULT_MAX_EXPANDED_MATCH_COUNT,
    optionName: 'maxExpandedMatchCount'
  });
  const maxDecisionCount = resolveLimitWithEnv({
    provided: options.maxDecisionCount,
    envName: 'VFS_SHARE_POLICY_COMPILER_MAX_DECISION_COUNT',
    fallback: DEFAULT_MAX_DECISION_COUNT,
    optionName: 'maxDecisionCount'
  });
  const lockTimeoutMs = resolveLimitWithEnv({
    provided: options.lockTimeoutMs,
    envName: 'VFS_SHARE_POLICY_COMPILER_LOCK_TIMEOUT_MS',
    fallback: DEFAULT_LOCK_TIMEOUT_MS,
    optionName: 'lockTimeoutMs'
  });
  const statementTimeoutMs = resolveLimitWithEnv({
    provided: options.statementTimeoutMs,
    envName: 'VFS_SHARE_POLICY_COMPILER_STATEMENT_TIMEOUT_MS',
    fallback: DEFAULT_STATEMENT_TIMEOUT_MS,
    optionName: 'statementTimeoutMs'
  });
  const emitMetrics = shouldEmitVfsSharePolicyCompilerMetrics(
    options.emitMetrics
  );
  const lockKey = buildCompileLockKey(policyIds, options.lockKey);

  let loadStateMs = 0;
  let compileCoreMs = 0;
  let materializeMs = 0;
  let staleRevocationMs = 0;
  let policyCount = 0;
  let activePolicyCount = 0;
  let selectorCount = 0;
  let principalCount = 0;
  let expandedMatchCount = 0;
  let decisionsCount = 0;
  let touchedAclEntryCount = 0;
  let staleRevocationCount = 0;

  let inTransaction = false;
  try {
    const loadStateStartedAtMs = Date.now();
    if (transactional) {
      await client.query('BEGIN');
      inTransaction = true;
      await client.query(
        `SET LOCAL lock_timeout = '${String(lockTimeoutMs)}ms'`
      );
      await client.query(
        `SET LOCAL statement_timeout = '${String(statementTimeoutMs)}ms'`
      );
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1::text))', [
        lockKey
      ]);
    }

    const state = await loadSharePolicyState(client, policyIds);
    loadStateMs = Date.now() - loadStateStartedAtMs;

    const compileCoreStartedAtMs = Date.now();
    const compiled = compileSharePolicyCore({
      policies: state.policies,
      selectors: state.selectors,
      principals: state.principals,
      registryItems: state.registryItems,
      links: state.links,
      now
    });
    compileCoreMs = Date.now() - compileCoreStartedAtMs;
    policyCount = compiled.policyCount;
    activePolicyCount = compiled.activePolicyCount;
    selectorCount = compiled.selectorCount;
    principalCount = compiled.principalCount;
    expandedMatchCount = compiled.expandedMatchCount;
    decisionsCount = compiled.decisions.length;

    if (compiled.expandedMatchCount > maxExpandedMatchCount) {
      throw new Error(
        `Compiler guardrail exceeded: expandedMatchCount (${compiled.expandedMatchCount}) > maxExpandedMatchCount (${maxExpandedMatchCount})`
      );
    }
    if (compiled.decisions.length > maxDecisionCount) {
      throw new Error(
        `Compiler guardrail exceeded: decisionsCount (${compiled.decisions.length}) > maxDecisionCount (${maxDecisionCount})`
      );
    }

    let result: CompileVfsSharePoliciesResult;
    if (dryRun) {
      result = {
        compilerRunId,
        policyCount: compiled.policyCount,
        activePolicyCount: compiled.activePolicyCount,
        selectorCount: compiled.selectorCount,
        principalCount: compiled.principalCount,
        expandedMatchCount: compiled.expandedMatchCount,
        decisionsCount: compiled.decisions.length,
        touchedAclEntryCount: 0,
        staleRevocationCount: 0
      };
    } else {
      const materializeStartedAtMs = Date.now();
      const touchedAclEntryIds = await materializeCompiledDecisions(
        client,
        compiled.decisions,
        actorId,
        now,
        compilerRunId
      );
      materializeMs = Date.now() - materializeStartedAtMs;
      touchedAclEntryCount = touchedAclEntryIds.size;

      const staleRevocationStartedAtMs = Date.now();
      const existingDerived = policyIds
        ? await client.query<DerivedAclRow>(
            `
            SELECT DISTINCT acl_entry_id
            FROM vfs_acl_entry_provenance
            WHERE provenance_type = 'derivedPolicy'
              AND policy_id = ANY($1::text[])
            `,
            [policyIds]
          )
        : await client.query<DerivedAclRow>(
            `
            SELECT DISTINCT acl_entry_id
            FROM vfs_acl_entry_provenance
            WHERE provenance_type = 'derivedPolicy'
            `
          );

      const staleAclEntryIds = existingDerived.rows
        .map((row) => row.acl_entry_id)
        .filter((aclEntryId) => !touchedAclEntryIds.has(aclEntryId));

      if (staleAclEntryIds.length > 0) {
        await client.query(
          `
          UPDATE vfs_acl_entries
          SET revoked_at = $1, updated_at = $1
          WHERE id = ANY($2::text[])
            AND NOT EXISTS (
              SELECT 1 FROM vfs_acl_entry_provenance p
              WHERE p.acl_entry_id = vfs_acl_entries.id
                AND p.provenance_type = 'direct'
            )
          `,
          [now, staleAclEntryIds]
        );
        await client.query(
          `
          UPDATE vfs_acl_entry_provenance
          SET
            decision = 'deny',
            policy_id = NULL,
            selector_id = NULL,
            precedence = 0,
            compiled_at = $1,
            compiler_run_id = $2,
            updated_at = $1
          WHERE acl_entry_id = ANY($3::text[])
            AND provenance_type = 'derivedPolicy'
          `,
          [now, compilerRunId, staleAclEntryIds]
        );
      }
      staleRevocationCount = staleAclEntryIds.length;
      staleRevocationMs = Date.now() - staleRevocationStartedAtMs;

      result = {
        compilerRunId,
        policyCount: compiled.policyCount,
        activePolicyCount: compiled.activePolicyCount,
        selectorCount: compiled.selectorCount,
        principalCount: compiled.principalCount,
        expandedMatchCount: compiled.expandedMatchCount,
        decisionsCount: compiled.decisions.length,
        touchedAclEntryCount,
        staleRevocationCount
      };
    }

    if (transactional) {
      await client.query('COMMIT');
      inTransaction = false;
    }

    const totalMs = Date.now() - startedAtMs;
    const metrics: CompileVfsSharePoliciesMetrics = {
      ...result,
      dryRun,
      transactional,
      loadStateMs,
      compileCoreMs,
      materializeMs,
      staleRevocationMs,
      totalMs
    };
    options.onMetrics?.(metrics);
    if (emitMetrics) {
      emitVfsSharePolicyCompilerRunMetric(
        buildVfsSharePolicyCompilerRunMetric({
          compilerRunId,
          success: true,
          dryRun,
          transactional,
          policyFilterCount: policyIds?.length ?? 0,
          maxExpandedMatchCount,
          maxDecisionCount,
          lockTimeoutMs,
          statementTimeoutMs,
          counts: {
            policyCount: metrics.policyCount,
            activePolicyCount: metrics.activePolicyCount,
            selectorCount: metrics.selectorCount,
            principalCount: metrics.principalCount,
            expandedMatchCount: metrics.expandedMatchCount,
            decisionsCount: metrics.decisionsCount,
            touchedAclEntryCount: metrics.touchedAclEntryCount,
            staleRevocationCount: metrics.staleRevocationCount
          },
          durations: {
            loadStateMs: metrics.loadStateMs,
            compileCoreMs: metrics.compileCoreMs,
            materializeMs: metrics.materializeMs,
            staleRevocationMs: metrics.staleRevocationMs,
            totalMs: metrics.totalMs
          }
        })
      );
    }
    return result;
  } catch (error) {
    if (inTransaction) {
      try {
        await client.query('ROLLBACK');
      } catch {
        // no-op: preserve original compiler failure
      }
    }
    if (emitMetrics) {
      emitVfsSharePolicyCompilerRunMetric(
        buildVfsSharePolicyCompilerRunMetric({
          compilerRunId,
          success: false,
          dryRun,
          transactional,
          policyFilterCount: policyIds?.length ?? 0,
          maxExpandedMatchCount,
          maxDecisionCount,
          lockTimeoutMs,
          statementTimeoutMs,
          counts: {
            policyCount,
            activePolicyCount,
            selectorCount,
            principalCount,
            expandedMatchCount,
            decisionsCount,
            touchedAclEntryCount,
            staleRevocationCount
          },
          durations: {
            loadStateMs,
            compileCoreMs,
            materializeMs,
            staleRevocationMs,
            totalMs: Date.now() - startedAtMs
          },
          error
        })
      );
    }
    throw error;
  }
}
