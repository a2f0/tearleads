import type { PgQueryable } from './vfsSharePolicyCompilerState.js';

type PreviewAccessLevel = 'read' | 'write' | 'admin';
type PreviewPrincipalType = 'user' | 'group' | 'organization';
const MAX_PREVIEW_QUERY_DEPTH = 50;

interface TreeRow {
  item_id: string | null;
  object_type: string | null;
  depth: number | string | null;
  node_path: string | null;
  total_count: number | string;
}

interface PageTreeRow {
  item_id: string;
  object_type: string;
  depth: number | string;
  node_path: string;
}

interface AclRow {
  id: string;
  item_id: string;
  access_level: PreviewAccessLevel;
  revoked_at: Date | string | null;
}

interface ProvenanceRow {
  acl_entry_id: string;
  policy_id: string | null;
}

type SharePolicyPreviewNodeState =
  | 'included'
  | 'excluded'
  | 'denied'
  | 'direct'
  | 'derived';

interface SharePolicyPreviewNode {
  itemId: string;
  objectType: string;
  depth: number;
  path: string;
  state: SharePolicyPreviewNodeState;
  effectiveAccessLevel: PreviewAccessLevel | null;
  sourcePolicyIds: string[];
}

interface SharePolicyPreviewSummary {
  totalMatchingNodes: number;
  returnedNodes: number;
  directCount: number;
  derivedCount: number;
  deniedCount: number;
  includedCount: number;
  excludedCount: number;
}

interface BuildSharePolicyPreviewTreeOptions {
  rootItemId: string;
  principalType: PreviewPrincipalType;
  principalId: string;
  limit: number;
  cursor: string | null;
  maxDepth: number | null;
  search: string | null;
  objectTypes: string[] | null;
}

interface BuildSharePolicyPreviewTreeResult {
  nodes: SharePolicyPreviewNode[];
  summary: SharePolicyPreviewSummary;
  nextCursor: string | null;
}

function parseCount(value: number | string): number {
  if (typeof value === 'number') {
    return value;
  }
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : 0;
}

function toNodeState(
  aclId: string,
  revokedAt: Date | string | null
): {
  state: SharePolicyPreviewNodeState;
  included: boolean;
} {
  if (revokedAt !== null) {
    return {
      state: 'denied',
      included: false
    };
  }
  if (aclId.startsWith('policy-compiled:')) {
    return {
      state: 'derived',
      included: true
    };
  }
  if (aclId.startsWith('share:') || aclId.startsWith('org-share:')) {
    return {
      state: 'direct',
      included: true
    };
  }
  return {
    state: 'included',
    included: true
  };
}

function escapeSearchLikePattern(value: string): string {
  return value.replace(/[%_\\]/g, '\\$&');
}

function normalizeSearchPattern(search: string | null): string | null {
  if (!search) {
    return null;
  }
  const trimmed = search.trim().toLowerCase();
  if (trimmed.length === 0) {
    return null;
  }
  return `%${escapeSearchLikePattern(trimmed)}%`;
}

function normalizeObjectTypes(objectTypes: string[] | null): string[] | null {
  if (!objectTypes) {
    return null;
  }
  const normalized = objectTypes
    .map((value) => value.trim())
    .filter(
      (value, index, array) =>
        value.length > 0 && array.indexOf(value) === index
    )
    .sort((left, right) => left.localeCompare(right));
  return normalized.length > 0 ? normalized : null;
}

function normalizePageRows(rows: TreeRow[]): PageTreeRow[] {
  return rows.flatMap((row) => {
    if (
      row.item_id === null ||
      row.object_type === null ||
      row.depth === null ||
      row.node_path === null
    ) {
      return [];
    }
    return [
      {
        item_id: row.item_id,
        object_type: row.object_type,
        depth: row.depth,
        node_path: row.node_path
      }
    ];
  });
}

export async function buildSharePolicyPreviewTree(
  client: PgQueryable,
  options: BuildSharePolicyPreviewTreeOptions
): Promise<BuildSharePolicyPreviewTreeResult> {
  const searchPattern = normalizeSearchPattern(options.search);
  const objectTypes = normalizeObjectTypes(options.objectTypes);
  const pageLimit = Math.max(1, options.limit);
  const previewDepth =
    options.maxDepth === null
      ? MAX_PREVIEW_QUERY_DEPTH
      : Math.min(Math.max(options.maxDepth, 0), MAX_PREVIEW_QUERY_DEPTH);

  const treeRowsResult = await client.query<TreeRow>(
    `
    WITH RECURSIVE tree AS (
      SELECT
        r.id AS item_id,
        r.object_type,
        0 AS depth,
        r.id::text AS node_path,
        ARRAY[r.id]::text[] AS path
      FROM vfs_registry r
      WHERE r.id = $1

      UNION ALL

      SELECT
        child.id AS item_id,
        child.object_type,
        tree.depth + 1 AS depth,
        tree.node_path || '/' || child.id AS node_path,
        tree.path || child.id AS path
      FROM tree
      JOIN vfs_links l
        ON l.parent_id = tree.item_id
      JOIN vfs_registry child
        ON child.id = l.child_id
      WHERE tree.depth < $2
        AND NOT child.id = ANY(tree.path)
    ),
    filtered AS (
      SELECT item_id, object_type, depth, node_path
      FROM tree
      WHERE ($3::text IS NULL OR LOWER(item_id) LIKE $3 ESCAPE '\\' OR LOWER(object_type) LIKE $3 ESCAPE '\\')
        AND ($4::text[] IS NULL OR object_type = ANY($4))
    ),
    total AS (
      SELECT COUNT(*)::bigint AS total_count
      FROM filtered
    ),
    page AS (
      SELECT item_id, object_type, depth, node_path
      FROM filtered
      WHERE ($5::text IS NULL OR node_path > $5)
      ORDER BY node_path ASC
      LIMIT $6
    )
    SELECT
      page.item_id,
      page.object_type,
      page.depth,
      page.node_path,
      total.total_count
    FROM total
    LEFT JOIN page ON TRUE
    ORDER BY page.node_path ASC NULLS LAST
    `,
    [
      options.rootItemId,
      previewDepth,
      searchPattern,
      objectTypes,
      options.cursor,
      pageLimit + 1
    ]
  );

  const totalMatchingNodes = parseCount(
    treeRowsResult.rows[0]?.total_count ?? 0
  );
  const matchingRows = normalizePageRows(treeRowsResult.rows);
  const pageRows = matchingRows.slice(0, pageLimit);
  const hasMore = matchingRows.length > pageLimit;
  const nextCursor = hasMore ? (pageRows.at(-1)?.node_path ?? null) : null;
  const itemIds = pageRows.map((row) => row.item_id);
  if (itemIds.length === 0) {
    return {
      nodes: [],
      nextCursor,
      summary: {
        totalMatchingNodes,
        returnedNodes: 0,
        directCount: 0,
        derivedCount: 0,
        deniedCount: 0,
        includedCount: 0,
        excludedCount: 0
      }
    };
  }

  const aclRowsResult = await client.query<AclRow>(
    `
    SELECT id, item_id, access_level, revoked_at
    FROM vfs_acl_entries
    WHERE item_id = ANY($1::text[])
      AND principal_type = $2
      AND principal_id = $3
    `,
    [itemIds, options.principalType, options.principalId]
  );

  const aclEntryIds = aclRowsResult.rows.map((row) => row.id);
  const provenanceRowsResult =
    aclEntryIds.length > 0
      ? await client.query<ProvenanceRow>(
          `
          SELECT acl_entry_id, policy_id
          FROM vfs_acl_entry_provenance
          WHERE provenance_type = 'derivedPolicy'
            AND acl_entry_id = ANY($1::text[])
          `,
          [aclEntryIds]
        )
      : { rows: [] as ProvenanceRow[] };

  const aclByItemId = new Map<string, AclRow>();
  for (const aclRow of aclRowsResult.rows) {
    aclByItemId.set(aclRow.item_id, aclRow);
  }

  const policyIdsByAclEntryId = new Map<string, Set<string>>();
  for (const provenanceRow of provenanceRowsResult.rows) {
    if (provenanceRow.policy_id === null) {
      continue;
    }
    const existing = policyIdsByAclEntryId.get(provenanceRow.acl_entry_id);
    if (existing) {
      existing.add(provenanceRow.policy_id);
    } else {
      policyIdsByAclEntryId.set(
        provenanceRow.acl_entry_id,
        new Set([provenanceRow.policy_id])
      );
    }
  }

  let directCount = 0;
  let derivedCount = 0;
  let deniedCount = 0;
  let includedCount = 0;
  let excludedCount = 0;

  const nodes: SharePolicyPreviewNode[] = pageRows.map((row) => {
    const aclRow = aclByItemId.get(row.item_id);
    if (!aclRow) {
      excludedCount += 1;
      return {
        itemId: row.item_id,
        objectType: row.object_type,
        depth: parseCount(row.depth),
        path: row.node_path,
        state: 'excluded',
        effectiveAccessLevel: null,
        sourcePolicyIds: []
      };
    }

    const stateData = toNodeState(aclRow.id, aclRow.revoked_at);
    if (stateData.state === 'direct') {
      directCount += 1;
    } else if (stateData.state === 'derived') {
      derivedCount += 1;
    } else if (stateData.state === 'denied') {
      deniedCount += 1;
    }
    if (stateData.included) {
      includedCount += 1;
    }

    const sourcePolicyIds = Array.from(
      policyIdsByAclEntryId.get(aclRow.id) ?? new Set<string>()
    ).sort((left, right) => left.localeCompare(right));

    return {
      itemId: row.item_id,
      objectType: row.object_type,
      depth: parseCount(row.depth),
      path: row.node_path,
      state: stateData.state,
      effectiveAccessLevel: aclRow.access_level,
      sourcePolicyIds
    };
  });

  return {
    nodes,
    nextCursor,
    summary: {
      totalMatchingNodes,
      returnedNodes: nodes.length,
      directCount,
      derivedCount,
      deniedCount,
      includedCount,
      excludedCount
    }
  };
}
