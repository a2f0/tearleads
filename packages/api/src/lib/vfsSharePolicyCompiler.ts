import {
  compileSharePolicyCore,
  type LinkEdge,
  type PolicyPrincipalType,
  type RegistryItemType,
  type SharePolicyDefinition,
  type SharePolicyPrincipalDefinition,
  type SharePolicySelectorDefinition
} from './vfsSharePolicyCompilerCore.js';

interface QueryResultRow<T> {
  rows: T[];
}

interface PgQueryable {
  query<T>(text: string, values?: unknown[]): Promise<QueryResultRow<T>>;
}

interface PolicyRow {
  id: string;
  root_item_id: string;
  status: 'draft' | 'active' | 'paused' | 'revoked';
  revoked_at: Date | string | null;
  expires_at: Date | string | null;
}

interface SelectorRow {
  id: string;
  policy_id: string;
  selector_kind: 'include' | 'exclude';
  match_mode: 'subtree' | 'children' | 'exact';
  anchor_item_id: string | null;
  max_depth: number | null;
  include_root: boolean;
  object_types: unknown;
  selector_order: number;
}

interface PrincipalRow {
  id: string;
  policy_id: string;
  principal_type: PolicyPrincipalType;
  principal_id: string;
  access_level: 'read' | 'write' | 'admin';
}

interface RegistryRow {
  id: string;
  object_type: string;
}

interface LinkRow {
  parent_id: string;
  child_id: string;
}

interface AclUpsertRow {
  id: string;
}

interface DerivedAclRow {
  acl_entry_id: string;
}

function toDateOrNull(value: Date | string | null): Date | null {
  if (value === null) {
    return null;
  }
  if (value instanceof Date) {
    return Number.isFinite(value.getTime()) ? value : null;
  }
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) {
    return null;
  }
  return new Date(parsed);
}

function parseObjectTypes(value: unknown): string[] | null {
  if (!Array.isArray(value)) {
    return null;
  }
  const filtered = value.filter(
    (entry): entry is string => typeof entry === 'string'
  );
  return filtered.length > 0 ? filtered : null;
}

function mapPolicies(rows: PolicyRow[]): SharePolicyDefinition[] {
  return rows.map((row) => ({
    id: row.id,
    rootItemId: row.root_item_id,
    status: row.status,
    revokedAt: toDateOrNull(row.revoked_at),
    expiresAt: toDateOrNull(row.expires_at)
  }));
}

function mapSelectors(rows: SelectorRow[]): SharePolicySelectorDefinition[] {
  return rows.map((row) => ({
    id: row.id,
    policyId: row.policy_id,
    selectorKind: row.selector_kind,
    matchMode: row.match_mode,
    anchorItemId: row.anchor_item_id,
    maxDepth: row.max_depth,
    includeRoot: row.include_root,
    objectTypes: parseObjectTypes(row.object_types),
    selectorOrder: row.selector_order
  }));
}

function mapPrincipals(rows: PrincipalRow[]): SharePolicyPrincipalDefinition[] {
  return rows.map((row) => ({
    id: row.id,
    policyId: row.policy_id,
    principalType: row.principal_type,
    principalId: row.principal_id,
    accessLevel: row.access_level
  }));
}

function mapRegistry(rows: RegistryRow[]): RegistryItemType[] {
  return rows.map((row) => ({
    id: row.id,
    objectType: row.object_type
  }));
}

function mapLinks(rows: LinkRow[]): LinkEdge[] {
  return rows.map((row) => ({
    parentId: row.parent_id,
    childId: row.child_id
  }));
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

async function loadPolicyState(client: PgQueryable): Promise<{
  policies: SharePolicyDefinition[];
  selectors: SharePolicySelectorDefinition[];
  principals: SharePolicyPrincipalDefinition[];
  registryItems: RegistryItemType[];
  links: LinkEdge[];
}> {
  const [policyRows, selectorRows, principalRows, registryRows, linkRows] =
    await Promise.all([
      client.query<PolicyRow>(
        `
        SELECT id, root_item_id, status, revoked_at, expires_at
        FROM vfs_share_policies
      `
      ),
      client.query<SelectorRow>(
        `
        SELECT
          id,
          policy_id,
          selector_kind,
          match_mode,
          anchor_item_id,
          max_depth,
          include_root,
          object_types,
          selector_order
        FROM vfs_share_policy_selectors
      `
      ),
      client.query<PrincipalRow>(
        `
        SELECT id, policy_id, principal_type, principal_id, access_level
        FROM vfs_share_policy_principals
      `
      ),
      client.query<RegistryRow>(
        `
        SELECT id, object_type
        FROM vfs_registry
      `
      ),
      client.query<LinkRow>(
        `
        SELECT parent_id, child_id
        FROM vfs_links
      `
      )
    ]);

  return {
    policies: mapPolicies(policyRows.rows),
    selectors: mapSelectors(selectorRows.rows),
    principals: mapPrincipals(principalRows.rows),
    registryItems: mapRegistry(registryRows.rows),
    links: mapLinks(linkRows.rows)
  };
}

export async function compileVfsSharePolicies(
  client: PgQueryable,
  options: CompileVfsSharePoliciesOptions = {}
): Promise<CompileVfsSharePoliciesResult> {
  const now = options.now ?? new Date();
  const compilerRunId = options.compilerRunId ?? createCompilerRunId(now);
  const actorId = options.actorId ?? null;
  const dryRun = options.dryRun ?? false;
  const state = await loadPolicyState(client);

  const compiled = compileSharePolicyCore({
    policies: state.policies,
    selectors: state.selectors,
    principals: state.principals,
    registryItems: state.registryItems,
    links: state.links,
    now
  });

  if (dryRun) {
    return {
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
  }

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
      DELETE FROM vfs_acl_entry_provenance
      WHERE acl_entry_id = $1
        AND provenance_type = 'derivedPolicy'
      `,
      [aclEntryId]
    );

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

  const existingDerived = await client.query<DerivedAclRow>(
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

  return {
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
