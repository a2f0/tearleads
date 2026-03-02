import { compileSharePolicyCore } from './vfsSharePolicyCompilerCore.js';
import { materializeCompiledDecisions } from './vfsSharePolicyCompilerMaterialization.js';
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
  const maxExpandedMatchCount = normalizeGuardrailLimit(
    options.maxExpandedMatchCount,
    DEFAULT_MAX_EXPANDED_MATCH_COUNT,
    'maxExpandedMatchCount'
  );
  const maxDecisionCount = normalizeGuardrailLimit(
    options.maxDecisionCount,
    DEFAULT_MAX_DECISION_COUNT,
    'maxDecisionCount'
  );
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
  const lockKey = buildCompileLockKey(policyIds, options.lockKey);
  let inTransaction = false;
  try {
    const loadStateStartedAtMs = Date.now();
    if (transactional) {
      await client.query('BEGIN');
      inTransaction = true;
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1::text))', [
        lockKey
      ]);
    }

    const state = await loadSharePolicyState(client, policyIds);
    const loadStateMs = Date.now() - loadStateStartedAtMs;

    const compileCoreStartedAtMs = Date.now();
    const compiled = compileSharePolicyCore({
      policies: state.policies,
      selectors: state.selectors,
      principals: state.principals,
      registryItems: state.registryItems,
      links: state.links,
      now
    });
    const compileCoreMs = Date.now() - compileCoreStartedAtMs;

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
    let materializeMs = 0;
    let staleRevocationMs = 0;
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
      const staleRevocationCount = staleAclEntryIds.length;
      staleRevocationMs = Date.now() - staleRevocationStartedAtMs;

      result = {
        compilerRunId,
        policyCount: compiled.policyCount,
        activePolicyCount: compiled.activePolicyCount,
        selectorCount: compiled.selectorCount,
        principalCount: compiled.principalCount,
        expandedMatchCount: compiled.expandedMatchCount,
        decisionsCount: compiled.decisions.length,
        touchedAclEntryCount: touchedAclEntryIds.size,
        staleRevocationCount
      };
    }

    if (transactional) {
      await client.query('COMMIT');
      inTransaction = false;
    }

    const totalMs = Date.now() - startedAtMs;
    options.onMetrics?.({
      ...result,
      dryRun,
      transactional,
      loadStateMs,
      compileCoreMs,
      materializeMs,
      staleRevocationMs,
      totalMs
    });
    return result;
  } catch (error) {
    if (inTransaction) {
      try {
        await client.query('ROLLBACK');
      } catch {
        // no-op: preserve original compiler failure
      }
    }
    throw error;
  }
}
