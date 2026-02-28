import type {
  LinkEdge,
  PolicyPrincipalType,
  RegistryItemType,
  SharePolicyDefinition,
  SharePolicyPrincipalDefinition,
  SharePolicySelectorDefinition
} from './vfsSharePolicyCompilerCore.js';

interface QueryResultRow<T> {
  rows: T[];
}

export interface PgQueryable {
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

export function normalizePolicyIds(
  policyIds: string[] | undefined
): string[] | null {
  if (!policyIds) {
    return null;
  }
  const normalized = policyIds
    .map((value) => value.trim())
    .filter(
      (value, index, array) =>
        value.length > 0 && array.indexOf(value) === index
    )
    .sort((left, right) => left.localeCompare(right));
  return normalized;
}

export function buildCompileLockKey(
  policyIds: string[] | null,
  providedLockKey: string | undefined
): string {
  if (providedLockKey !== undefined) {
    return providedLockKey;
  }
  if (!policyIds || policyIds.length === 0) {
    return 'vfs_share_policy_compile:all';
  }
  return `vfs_share_policy_compile:${policyIds.join(',')}`;
}

export async function loadSharePolicyState(
  client: PgQueryable,
  policyIds: string[] | null
): Promise<{
  policies: SharePolicyDefinition[];
  selectors: SharePolicySelectorDefinition[];
  principals: SharePolicyPrincipalDefinition[];
  registryItems: RegistryItemType[];
  links: LinkEdge[];
}> {
  const [policyRows, selectorRows, principalRows, registryRows, linkRows] =
    await Promise.all([
      policyIds
        ? client.query<PolicyRow>(
            `
            SELECT id, root_item_id, status, revoked_at, expires_at
            FROM vfs_share_policies
            WHERE id = ANY($1::text[])
          `,
            [policyIds]
          )
        : client.query<PolicyRow>(
            `
            SELECT id, root_item_id, status, revoked_at, expires_at
            FROM vfs_share_policies
          `
          ),
      policyIds
        ? client.query<SelectorRow>(
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
            WHERE policy_id = ANY($1::text[])
          `,
            [policyIds]
          )
        : client.query<SelectorRow>(
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
      policyIds
        ? client.query<PrincipalRow>(
            `
            SELECT id, policy_id, principal_type, principal_id, access_level
            FROM vfs_share_policy_principals
            WHERE policy_id = ANY($1::text[])
          `,
            [policyIds]
          )
        : client.query<PrincipalRow>(
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
