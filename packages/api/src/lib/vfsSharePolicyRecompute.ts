import {
  type CompileVfsSharePoliciesOptions,
  type CompileVfsSharePoliciesResult,
  compileVfsSharePolicies
} from './vfsSharePolicyCompiler.js';

interface QueryResultRow<T> {
  rows: T[];
}

interface PgQueryable {
  query<T>(text: string, values?: unknown[]): Promise<QueryResultRow<T>>;
}

type RecomputeTrigger =
  | {
      kind: 'policy';
      policyId: string;
    }
  | {
      kind: 'link';
      parentId: string;
      childId: string;
    }
  | {
      kind: 'metadata';
      itemId: string;
    };

interface PolicyIdRow {
  policy_id: string;
}

function normalizeIds(ids: string[]): string[] {
  return ids
    .map((value) => value.trim())
    .filter(
      (value, index, array) =>
        value.length > 0 && array.indexOf(value) === index
    )
    .sort((left, right) => left.localeCompare(right));
}

function itemsFromTrigger(trigger: RecomputeTrigger): string[] {
  if (trigger.kind === 'policy') {
    return [];
  }
  if (trigger.kind === 'link') {
    return normalizeIds([trigger.parentId, trigger.childId]);
  }
  return normalizeIds([trigger.itemId]);
}

export async function resolveImpactedSharePolicyIds(
  client: PgQueryable,
  trigger: RecomputeTrigger,
  now: Date
): Promise<string[]> {
  if (trigger.kind === 'policy') {
    return normalizeIds([trigger.policyId]);
  }

  const itemIds = itemsFromTrigger(trigger);
  if (itemIds.length === 0) {
    return [];
  }

  const result = await client.query<PolicyIdRow>(
    `
    WITH RECURSIVE policy_scope(policy_id, item_id, path) AS (
      SELECT
        p.id AS policy_id,
        p.root_item_id AS item_id,
        ARRAY[p.root_item_id]::text[] AS path
      FROM vfs_share_policies p
      WHERE p.status = 'active'
        AND p.revoked_at IS NULL
        AND (p.expires_at IS NULL OR p.expires_at > $2)

      UNION ALL

      SELECT
        ps.policy_id,
        l.child_id AS item_id,
        ps.path || l.child_id
      FROM policy_scope ps
      JOIN vfs_links l
        ON l.parent_id = ps.item_id
      WHERE NOT l.child_id = ANY(ps.path)
    )
    SELECT DISTINCT policy_id
    FROM policy_scope
    WHERE item_id = ANY($1::text[])
    ORDER BY policy_id ASC
    `,
    [itemIds, now]
  );

  return normalizeIds(result.rows.map((row) => row.policy_id));
}

interface RunIncrementalRecomputeOptions
  extends Omit<CompileVfsSharePoliciesOptions, 'policyIds'> {
  compile?: (
    client: PgQueryable,
    options: CompileVfsSharePoliciesOptions
  ) => Promise<CompileVfsSharePoliciesResult>;
}

interface RunIncrementalRecomputeResult {
  impactedPolicyIds: string[];
  compileResult: CompileVfsSharePoliciesResult | null;
}

export async function runIncrementalSharePolicyRecompute(
  client: PgQueryable,
  trigger: RecomputeTrigger,
  options: RunIncrementalRecomputeOptions = {}
): Promise<RunIncrementalRecomputeResult> {
  const now = options.now ?? new Date();
  const impactedPolicyIds = await resolveImpactedSharePolicyIds(
    client,
    trigger,
    now
  );
  if (impactedPolicyIds.length === 0) {
    return {
      impactedPolicyIds,
      compileResult: null
    };
  }

  const compileFn = options.compile ?? compileVfsSharePolicies;
  const compileOptions: CompileVfsSharePoliciesOptions = {
    now,
    actorId: options.actorId ?? null,
    dryRun: options.dryRun ?? false,
    policyIds: impactedPolicyIds
  };
  if (options.compilerRunId !== undefined) {
    compileOptions.compilerRunId = options.compilerRunId;
  }
  const compileResult = await compileFn(client, compileOptions);

  return {
    impactedPolicyIds,
    compileResult
  };
}
