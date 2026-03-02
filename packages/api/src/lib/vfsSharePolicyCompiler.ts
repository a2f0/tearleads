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

function createCompilerRunId(now: Date): string {
  return `policy-compile:${now.toISOString()}:${crypto.randomUUID()}`;
}

export interface CompileVfsSharePoliciesOptions {
  now?: Date;
  compilerRunId?: string;
  actorId?: string | null;
  dryRun?: boolean;
  policyIds?: string[];
  transactional?: boolean;
  lockKey?: string;
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

export async function compileVfsSharePolicies(
  client: PgQueryable,
  options: CompileVfsSharePoliciesOptions = {}
): Promise<CompileVfsSharePoliciesResult> {
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
  const lockKey = buildCompileLockKey(policyIds, options.lockKey);
  let inTransaction = false;
  try {
    if (transactional) {
      await client.query('BEGIN');
      inTransaction = true;
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1::text))', [
        lockKey
      ]);
    }

    const state = await loadSharePolicyState(client, policyIds);

    const compiled = compileSharePolicyCore({
      policies: state.policies,
      selectors: state.selectors,
      principals: state.principals,
      registryItems: state.registryItems,
      links: state.links,
      now
    });

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
      const touchedAclEntryIds = await materializeCompiledDecisions(
        client,
        compiled.decisions,
        actorId,
        now,
        compilerRunId
      );

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
