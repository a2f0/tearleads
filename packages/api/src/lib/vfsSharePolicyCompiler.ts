import {
  compileSharePolicyCore,
  type PolicyPrincipalType
} from './vfsSharePolicyCompilerCore.js';
import {
  buildCompileLockKey,
  loadSharePolicyState,
  normalizePolicyIds,
  type PgQueryable
} from './vfsSharePolicyCompilerState.js';

interface AclUpsertRow {
  id: string;
}

interface DerivedAclRow {
  acl_entry_id: string;
}

function buildCompiledAclId(
  itemId: string,
  principalType: PolicyPrincipalType,
  principalId: string
): string {
  return `policy-compiled:${principalType}:${principalId}:${itemId}`;
}

function buildDerivedProvenanceId(aclEntryId: string): string {
  return `policy-derived:${aclEntryId}`;
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
      const touchedAclEntryIds = new Set<string>();
      for (const decision of compiled.decisions) {
        const upsertResult = await client.query<AclUpsertRow>(
          `
          INSERT INTO vfs_acl_entries (
            id,
            item_id,
            principal_type,
            principal_id,
            access_level,
            granted_by,
            created_at,
            updated_at,
            revoked_at
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $7, $8)
          ON CONFLICT (item_id, principal_type, principal_id)
          DO UPDATE SET
            access_level = EXCLUDED.access_level,
            granted_by = EXCLUDED.granted_by,
            updated_at = EXCLUDED.updated_at,
            revoked_at = EXCLUDED.revoked_at
          RETURNING id
          `,
          [
            buildCompiledAclId(
              decision.itemId,
              decision.principalType,
              decision.principalId
            ),
            decision.itemId,
            decision.principalType,
            decision.principalId,
            decision.accessLevel,
            actorId,
            now,
            decision.decision === 'deny' ? now : null
          ]
        );

        const aclEntryId = upsertResult.rows[0]?.id;
        if (!aclEntryId) {
          throw new Error('Failed to materialize ACL decision');
        }
        touchedAclEntryIds.add(aclEntryId);

        await client.query(
          `
          INSERT INTO vfs_acl_entry_provenance (
            id,
            acl_entry_id,
            provenance_type,
            policy_id,
            selector_id,
            decision,
            precedence,
            compiled_at,
            compiler_run_id,
            created_at,
            updated_at
          ) VALUES ($1, $2, 'derivedPolicy', $3, $4, $5, $6, $7, $8, $7, $7)
          ON CONFLICT (id)
          DO UPDATE SET
            acl_entry_id = EXCLUDED.acl_entry_id,
            policy_id = EXCLUDED.policy_id,
            selector_id = EXCLUDED.selector_id,
            decision = EXCLUDED.decision,
            precedence = EXCLUDED.precedence,
            compiled_at = EXCLUDED.compiled_at,
            compiler_run_id = EXCLUDED.compiler_run_id,
            updated_at = EXCLUDED.updated_at
          `,
          [
            buildDerivedProvenanceId(aclEntryId),
            aclEntryId,
            decision.policyId,
            decision.selectorId,
            decision.decision,
            decision.precedence,
            now,
            compilerRunId
          ]
        );
      }

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

      let staleRevocationCount = 0;
      for (const row of existingDerived.rows) {
        if (touchedAclEntryIds.has(row.acl_entry_id)) {
          continue;
        }
        staleRevocationCount += 1;
        await client.query(
          `
          UPDATE vfs_acl_entries
          SET revoked_at = $1, updated_at = $1
          WHERE id = $2
          `,
          [now, row.acl_entry_id]
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
          WHERE acl_entry_id = $3
            AND provenance_type = 'derivedPolicy'
          `,
          [now, compilerRunId, row.acl_entry_id]
        );
      }

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
