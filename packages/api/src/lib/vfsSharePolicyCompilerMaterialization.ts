import {
  assertDirectProtectedSkips,
  buildCompiledAclId,
  buildDerivedProvenanceId,
  buildMaterializationKey,
  isDecisionDirectProtected,
  isPolicyPrincipalType
} from './vfsSharePolicyCompilerMaterializationHelpers.js';
import type { CompiledDecisionInput } from './vfsSharePolicyCompilerMaterializationTypes.js';
import type { PgQueryable } from './vfsSharePolicyCompilerState.js';

interface AclUpsertRow {
  id: string;
}

interface AclUpsertMaterializedRow extends AclUpsertRow {
  item_id: string;
  principal_type: string;
  principal_id: string;
}

const BATCH_MATERIALIZATION_THRESHOLD = 50;
const MATERIALIZATION_BATCH_SIZE = 500;

async function materializeDecisionsOneByOne(
  client: PgQueryable,
  decisions: CompiledDecisionInput[],
  actorId: string | null,
  now: Date,
  compilerRunId: string
): Promise<Set<string>> {
  const touchedAclEntryIds = new Set<string>();
  for (const decision of decisions) {
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
      WHERE (
        EXCLUDED.revoked_at IS NOT NULL
        OR vfs_acl_entries.revoked_at IS NOT NULL
        OR NOT EXISTS (
          SELECT 1 FROM vfs_acl_entry_provenance p
          WHERE p.acl_entry_id = vfs_acl_entries.id
            AND p.provenance_type = 'direct'
        )
      )
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
      const directProtected = await isDecisionDirectProtected(client, decision);
      if (!directProtected) {
        throw new Error('Failed to materialize ACL decision');
      }
      continue;
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

  return touchedAclEntryIds;
}

async function materializeDecisionsInBatch(
  client: PgQueryable,
  decisions: CompiledDecisionInput[],
  actorId: string | null,
  now: Date,
  compilerRunId: string
): Promise<Set<string>> {
  if (decisions.length === 0) {
    return new Set<string>();
  }

  const aclIds: string[] = [];
  const itemIds: string[] = [];
  const principalTypes: string[] = [];
  const principalIds: string[] = [];
  const accessLevels: string[] = [];
  const revokedAts: Array<Date | null> = [];
  const decisionByKey = new Map<string, CompiledDecisionInput>();

  for (const decision of decisions) {
    aclIds.push(
      buildCompiledAclId(
        decision.itemId,
        decision.principalType,
        decision.principalId
      )
    );
    itemIds.push(decision.itemId);
    principalTypes.push(decision.principalType);
    principalIds.push(decision.principalId);
    accessLevels.push(decision.accessLevel);
    revokedAts.push(decision.decision === 'deny' ? now : null);
    decisionByKey.set(
      buildMaterializationKey(
        decision.itemId,
        decision.principalType,
        decision.principalId
      ),
      decision
    );
  }

  const upsertResult = await client.query<AclUpsertMaterializedRow>(
    `
    WITH input_rows AS (
      SELECT *
      FROM UNNEST(
        $1::text[],
        $2::text[],
        $3::text[],
        $4::text[],
        $5::text[],
        $6::timestamptz[]
      ) AS rows(
        acl_id,
        item_id,
        principal_type,
        principal_id,
        access_level,
        revoked_at
      )
    )
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
    )
    SELECT
      input_rows.acl_id,
      input_rows.item_id,
      input_rows.principal_type,
      input_rows.principal_id,
      input_rows.access_level,
      $7,
      $8,
      $8,
      input_rows.revoked_at
    FROM input_rows
    ON CONFLICT (item_id, principal_type, principal_id)
    DO UPDATE SET
      access_level = EXCLUDED.access_level,
      granted_by = EXCLUDED.granted_by,
      updated_at = EXCLUDED.updated_at,
      revoked_at = EXCLUDED.revoked_at
    WHERE (
      EXCLUDED.revoked_at IS NOT NULL
      OR vfs_acl_entries.revoked_at IS NOT NULL
      OR NOT EXISTS (
        SELECT 1 FROM vfs_acl_entry_provenance p
        WHERE p.acl_entry_id = vfs_acl_entries.id
          AND p.provenance_type = 'direct'
      )
    )
    RETURNING id, item_id, principal_type, principal_id
    `,
    [
      aclIds,
      itemIds,
      principalTypes,
      principalIds,
      accessLevels,
      revokedAts,
      actorId,
      now
    ]
  );

  const touchedAclEntryIds = new Set<string>();
  const touchedDecisionKeys = new Set<string>();
  const provenanceIds: string[] = [];
  const provenanceAclEntryIds: string[] = [];
  const provenancePolicyIds: string[] = [];
  const provenanceSelectorIds: string[] = [];
  const provenanceDecisions: string[] = [];
  const provenancePrecedences: number[] = [];

  for (const row of upsertResult.rows) {
    if (!isPolicyPrincipalType(row.principal_type)) {
      throw new Error('Failed to materialize ACL decision');
    }
    touchedAclEntryIds.add(row.id);
    const decisionKey = buildMaterializationKey(
      row.item_id,
      row.principal_type,
      row.principal_id
    );
    touchedDecisionKeys.add(decisionKey);
    const decision = decisionByKey.get(decisionKey);
    if (!decision) {
      continue;
    }
    provenanceIds.push(buildDerivedProvenanceId(row.id));
    provenanceAclEntryIds.push(row.id);
    provenancePolicyIds.push(decision.policyId);
    provenanceSelectorIds.push(decision.selectorId);
    provenanceDecisions.push(decision.decision);
    provenancePrecedences.push(decision.precedence);
  }

  const skippedDecisions = decisions.filter((decision) => {
    const key = buildMaterializationKey(
      decision.itemId,
      decision.principalType,
      decision.principalId
    );
    return !touchedDecisionKeys.has(key);
  });
  await assertDirectProtectedSkips(client, skippedDecisions);

  if (provenanceIds.length > 0) {
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
      )
      SELECT
        rows.id,
        rows.acl_entry_id,
        'derivedPolicy',
        rows.policy_id,
        rows.selector_id,
        rows.decision,
        rows.precedence,
        $1,
        $2,
        $1,
        $1
      FROM UNNEST(
        $3::text[],
        $4::text[],
        $5::text[],
        $6::text[],
        $7::text[],
        $8::integer[]
      ) AS rows(
        id,
        acl_entry_id,
        policy_id,
        selector_id,
        decision,
        precedence
      )
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
        now,
        compilerRunId,
        provenanceIds,
        provenanceAclEntryIds,
        provenancePolicyIds,
        provenanceSelectorIds,
        provenanceDecisions,
        provenancePrecedences
      ]
    );
  }

  return touchedAclEntryIds;
}

export async function materializeCompiledDecisions(
  client: PgQueryable,
  decisions: CompiledDecisionInput[],
  actorId: string | null,
  now: Date,
  compilerRunId: string
): Promise<Set<string>> {
  if (decisions.length < BATCH_MATERIALIZATION_THRESHOLD) {
    return materializeDecisionsOneByOne(
      client,
      decisions,
      actorId,
      now,
      compilerRunId
    );
  }

  const touchedAclEntryIds = new Set<string>();
  for (
    let cursor = 0;
    cursor < decisions.length;
    cursor += MATERIALIZATION_BATCH_SIZE
  ) {
    const decisionChunk = decisions.slice(
      cursor,
      cursor + MATERIALIZATION_BATCH_SIZE
    );
    const chunkTouchedAclEntryIds = await materializeDecisionsInBatch(
      client,
      decisionChunk,
      actorId,
      now,
      compilerRunId
    );
    for (const aclEntryId of chunkTouchedAclEntryIds) {
      touchedAclEntryIds.add(aclEntryId);
    }
  }
  return touchedAclEntryIds;
}
