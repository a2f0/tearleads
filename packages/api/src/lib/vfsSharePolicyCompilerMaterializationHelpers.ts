import type { PolicyPrincipalType } from './vfsSharePolicyCompilerCore.js';
import type { CompiledDecisionInput } from './vfsSharePolicyCompilerMaterializationTypes.js';
import type { PgQueryable } from './vfsSharePolicyCompilerState.js';

const MATERIALIZATION_KEY_SEPARATOR = '\u0000';

export function buildCompiledAclId(
  itemId: string,
  principalType: PolicyPrincipalType,
  principalId: string
): string {
  return `policy-compiled:${principalType}:${principalId}:${itemId}`;
}

export function buildDerivedProvenanceId(aclEntryId: string): string {
  return `policy-derived:${aclEntryId}`;
}

export function buildMaterializationKey(
  itemId: string,
  principalType: PolicyPrincipalType,
  principalId: string
): string {
  return [itemId, principalType, principalId].join(
    MATERIALIZATION_KEY_SEPARATOR
  );
}

export function isPolicyPrincipalType(
  value: string
): value is PolicyPrincipalType {
  return value === 'user' || value === 'group' || value === 'organization';
}

export async function isDecisionDirectProtected(
  client: PgQueryable,
  decision: CompiledDecisionInput
): Promise<boolean> {
  const directProvenanceRows = await client.query<{ id: string }>(
    `
    SELECT e.id
    FROM vfs_acl_entries e
    WHERE e.item_id = $1
      AND e.principal_type = $2
      AND e.principal_id = $3
      AND EXISTS (
        SELECT 1
        FROM vfs_acl_entry_provenance p
        WHERE p.acl_entry_id = e.id
          AND p.provenance_type = 'direct'
      )
    LIMIT 1
    `,
    [decision.itemId, decision.principalType, decision.principalId]
  );
  return directProvenanceRows.rows.length > 0;
}

export async function assertDirectProtectedSkips(
  client: PgQueryable,
  skippedDecisions: CompiledDecisionInput[]
): Promise<void> {
  if (skippedDecisions.length === 0) {
    return;
  }

  const itemIds = skippedDecisions.map((decision) => decision.itemId);
  const principalTypes = skippedDecisions.map(
    (decision) => decision.principalType
  );
  const principalIds = skippedDecisions.map((decision) => decision.principalId);
  const directProtectedRows = await client.query<{
    item_id: string;
    principal_type: string;
    principal_id: string;
  }>(
    `
    WITH input_rows AS (
      SELECT *
      FROM UNNEST(
        $1::text[],
        $2::text[],
        $3::text[]
      ) AS rows(
        item_id,
        principal_type,
        principal_id
      )
    )
    SELECT
      input_rows.item_id,
      input_rows.principal_type,
      input_rows.principal_id
    FROM input_rows
    JOIN vfs_acl_entries e
      ON e.item_id = input_rows.item_id
     AND e.principal_type = input_rows.principal_type
     AND e.principal_id = input_rows.principal_id
    JOIN vfs_acl_entry_provenance p
      ON p.acl_entry_id = e.id
     AND p.provenance_type = 'direct'
    `,
    [itemIds, principalTypes, principalIds]
  );

  const protectedKeys = new Set<string>();
  for (const row of directProtectedRows.rows) {
    if (!isPolicyPrincipalType(row.principal_type)) {
      continue;
    }
    protectedKeys.add(
      buildMaterializationKey(row.item_id, row.principal_type, row.principal_id)
    );
  }

  for (const decision of skippedDecisions) {
    const key = buildMaterializationKey(
      decision.itemId,
      decision.principalType,
      decision.principalId
    );
    if (!protectedKeys.has(key)) {
      throw new Error('Failed to materialize ACL decision');
    }
  }
}
