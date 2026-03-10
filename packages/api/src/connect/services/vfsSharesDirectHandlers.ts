import { create } from '@bufbuild/protobuf';
import { Code, ConnectError } from '@connectrpc/connect';
import {
  type ShareTargetSearchResult,
  VFS_CONTAINER_OBJECT_TYPES,
  type VfsShareType
} from '@tearleads/shared';
import type {
  VfsSharePolicyPreviewNodePayload,
  VfsSharePolicyPreviewSummaryPayload,
  VfsSharesGetSharePolicyPreviewResponse,
  VfsSharesSearchShareTargetsResponse,
  VfsShareTargetPayload
} from '@tearleads/shared/gen/tearleads/v2/vfs_shares_pb';
import {
  VfsSharePolicyPreviewNodePayloadSchema,
  VfsSharePolicyPreviewSummaryPayloadSchema,
  VfsSharesGetSharePolicyPreviewResponseSchema,
  VfsSharesSearchShareTargetsResponseSchema,
  VfsShareTargetPayloadSchema
} from '@tearleads/shared/gen/tearleads/v2/vfs_shares_pb';
import { getPool, getPostgresPool } from '../../lib/postgres.js';
import { buildSharePolicyPreviewTree } from '../../lib/vfsSharePolicyPreviewTree.js';
import {
  authenticate,
  resolveOrganizationMembership
} from './connectRequestAuth.js';
import { toConnectCode } from './httpStatusToConnectCode.js';
import {
  isValidShareType,
  loadOrgShareAuthorizationContext,
  loadShareAuthorizationContext
} from './vfsSharesDirectShared.js';

type PreviewPrincipalType = 'user' | 'group' | 'organization';

const CONTAINER_OBJECT_TYPES = new Set<string>(VFS_CONTAINER_OBJECT_TYPES);
const DEFAULT_PREVIEW_LIMIT = 100;
const MAX_PREVIEW_LIMIT = 500;
const DEFAULT_PREVIEW_MAX_DEPTH = 50;
const MAX_OBJECT_TYPE_FILTERS = 25;
const MAX_OBJECT_TYPE_LENGTH = 64;

function isPreviewPrincipalType(value: string): value is PreviewPrincipalType {
  return value === 'user' || value === 'group' || value === 'organization';
}

function resolveLimit(limit: number): number {
  if (!Number.isFinite(limit) || limit <= 0) {
    return DEFAULT_PREVIEW_LIMIT;
  }
  return Math.min(Math.floor(limit), MAX_PREVIEW_LIMIT);
}

function resolveMaxDepth(maxDepth: number): number {
  if (!Number.isFinite(maxDepth) || maxDepth <= 0) {
    return DEFAULT_PREVIEW_MAX_DEPTH;
  }
  return Math.min(Math.floor(maxDepth), DEFAULT_PREVIEW_MAX_DEPTH);
}

function parseObjectTypes(raw: string): string[] | null {
  const uniqueValues = new Set<string>();
  for (const part of raw.split(',')) {
    const value = part.trim();
    if (value.length === 0) {
      continue;
    }
    if (value.length > MAX_OBJECT_TYPE_LENGTH) {
      throw new ConnectError(
        'objectType values must be 64 characters or fewer',
        Code.InvalidArgument
      );
    }
    uniqueValues.add(value);
    if (uniqueValues.size > MAX_OBJECT_TYPE_FILTERS) {
      throw new ConnectError(
        `objectType supports at most ${MAX_OBJECT_TYPE_FILTERS} values`,
        Code.InvalidArgument
      );
    }
  }

  return uniqueValues.size > 0 ? Array.from(uniqueValues) : null;
}

function parseObjectTypeValues(objectType: string[]): string[] | null {
  if (objectType.length === 0) {
    return null;
  }
  return parseObjectTypes(objectType.join(','));
}

function toShareTargetPayload(
  result: ShareTargetSearchResult
): VfsShareTargetPayload {
  return create(VfsShareTargetPayloadSchema, {
    id: result.id,
    type: result.type,
    name: result.name,
    ...(typeof result.description === 'string'
      ? { description: result.description }
      : {})
  });
}

function toSharePolicyPreviewNodePayload(
  node: Awaited<ReturnType<typeof buildSharePolicyPreviewTree>>['nodes'][number]
): VfsSharePolicyPreviewNodePayload {
  return create(VfsSharePolicyPreviewNodePayloadSchema, {
    itemId: node.itemId,
    objectType: node.objectType,
    depth: node.depth,
    path: node.path,
    state: node.state,
    ...(typeof node.effectiveAccessLevel === 'string'
      ? { effectiveAccessLevel: node.effectiveAccessLevel }
      : {}),
    sourcePolicyIds: node.sourcePolicyIds
  });
}

function toSharePolicyPreviewSummaryPayload(
  summary: Awaited<ReturnType<typeof buildSharePolicyPreviewTree>>['summary']
): VfsSharePolicyPreviewSummaryPayload {
  return create(VfsSharePolicyPreviewSummaryPayloadSchema, {
    totalMatchingNodes: summary.totalMatchingNodes,
    returnedNodes: summary.returnedNodes,
    directCount: summary.directCount,
    derivedCount: summary.derivedCount,
    deniedCount: summary.deniedCount,
    includedCount: summary.includedCount,
    excludedCount: summary.excludedCount
  });
}

function toSharePolicyPreviewResponse(
  preview: Awaited<ReturnType<typeof buildSharePolicyPreviewTree>>
): VfsSharesGetSharePolicyPreviewResponse {
  return create(VfsSharesGetSharePolicyPreviewResponseSchema, {
    nodes: preview.nodes.map((node) => toSharePolicyPreviewNodePayload(node)),
    summary: toSharePolicyPreviewSummaryPayload(preview.summary),
    ...(typeof preview.nextCursor === 'string'
      ? { nextCursor: preview.nextCursor }
      : {})
  });
}

export async function requireVfsSharesClaims(
  path: string,
  requestHeaders: Headers
): Promise<{ sub: string }> {
  const authResult = await authenticate(requestHeaders);
  if (!authResult.ok) {
    throw new ConnectError(authResult.error, toConnectCode(authResult.status));
  }

  const membershipResult = await resolveOrganizationMembership(
    path,
    requestHeaders,
    authResult.claims.sub
  );
  if (!membershipResult.ok) {
    throw new ConnectError(
      membershipResult.error,
      toConnectCode(membershipResult.status)
    );
  }

  return {
    sub: authResult.claims.sub
  };
}

export async function deleteShareDirect(
  request: { shareId: string },
  context: { requestHeader: Headers }
): Promise<{ deleted: boolean }> {
  const claims = await requireVfsSharesClaims(
    '/connect/tearleads.v2.VfsSharesService/DeleteShare',
    context.requestHeader
  );

  try {
    const pool = await getPostgresPool();
    const authContext = await loadShareAuthorizationContext(
      pool,
      request.shareId
    );
    if (!authContext) {
      throw new ConnectError('Share not found', Code.NotFound);
    }
    if (authContext.ownerId !== claims.sub) {
      throw new ConnectError(
        'Not authorized to delete this share',
        Code.PermissionDenied
      );
    }

    const revokedAt = new Date();
    const result = await pool.query(
      `UPDATE vfs_acl_entries
         SET revoked_at = $2,
             updated_at = $2
         WHERE id = $1
           AND revoked_at IS NULL`,
      [authContext.aclId, revokedAt]
    );

    return {
      deleted: result.rowCount !== null && result.rowCount > 0
    };
  } catch (error) {
    if (error instanceof ConnectError) {
      throw error;
    }
    console.error('Failed to delete VFS share:', error);
    throw new ConnectError('Failed to delete share', Code.Internal);
  }
}

export async function deleteOrgShareDirect(
  request: { shareId: string },
  context: { requestHeader: Headers }
): Promise<{ deleted: boolean }> {
  const claims = await requireVfsSharesClaims(
    '/connect/tearleads.v2.VfsSharesService/DeleteOrgShare',
    context.requestHeader
  );

  try {
    const pool = await getPostgresPool();
    const authContext = await loadOrgShareAuthorizationContext(
      pool,
      request.shareId
    );
    if (!authContext) {
      throw new ConnectError('Org share not found', Code.NotFound);
    }
    if (authContext.ownerId !== claims.sub) {
      throw new ConnectError(
        'Not authorized to delete this org share',
        Code.PermissionDenied
      );
    }

    const revokedAt = new Date();
    const result = await pool.query(
      `UPDATE vfs_acl_entries
         SET revoked_at = $2,
             updated_at = $2
         WHERE id = $1
           AND revoked_at IS NULL`,
      [authContext.aclId, revokedAt]
    );

    return {
      deleted: result.rowCount !== null && result.rowCount > 0
    };
  } catch (error) {
    if (error instanceof ConnectError) {
      throw error;
    }
    console.error('Failed to delete org share:', error);
    throw new ConnectError('Failed to delete org share', Code.Internal);
  }
}

export async function searchShareTargetsDirect(
  request: { q: string; type: string },
  context: { requestHeader: Headers }
): Promise<VfsSharesSearchShareTargetsResponse> {
  const claims = await requireVfsSharesClaims(
    '/connect/tearleads.v2.VfsSharesService/SearchShareTargets',
    context.requestHeader
  );

  if (request.q.trim().length < 1) {
    throw new ConnectError('Search query is required', Code.InvalidArgument);
  }

  const searchQuery = `%${request.q.trim().toLowerCase()}%`;
  const filterType: VfsShareType | null = isValidShareType(request.type)
    ? request.type
    : null;

  try {
    const pool = await getPool('read');
    const results: ShareTargetSearchResult[] = [];

    const userOrgResult = await pool.query<{ organization_id: string }>(
      `SELECT organization_id FROM user_organizations WHERE user_id = $1`,
      [claims.sub]
    );
    const userOrgIds = userOrgResult.rows.map((row) => row.organization_id);

    if ((!filterType || filterType === 'user') && userOrgIds.length > 0) {
      const usersResult = await pool.query<{ id: string; email: string }>(
        `SELECT DISTINCT u.id, u.email FROM users u
           INNER JOIN user_organizations uo ON uo.user_id = u.id
           WHERE LOWER(u.email) LIKE $1
             AND uo.organization_id = ANY($2)
           ORDER BY u.email
           LIMIT 10`,
        [searchQuery, userOrgIds]
      );
      for (const row of usersResult.rows) {
        results.push({
          id: row.id,
          type: 'user',
          name: row.email
        });
      }
    }

    if ((!filterType || filterType === 'group') && userOrgIds.length > 0) {
      const groupsResult = await pool.query<{
        id: string;
        name: string;
        org_name: string | null;
      }>(
        `SELECT g.id, g.name, o.name AS org_name
           FROM groups g
           LEFT JOIN organizations o ON o.id = g.organization_id
           WHERE LOWER(g.name) LIKE $1
             AND g.organization_id = ANY($2)
           ORDER BY g.name
           LIMIT 10`,
        [searchQuery, userOrgIds]
      );
      for (const row of groupsResult.rows) {
        results.push({
          id: row.id,
          type: 'group',
          name: row.name,
          description: row.org_name ?? undefined
        });
      }
    }

    if (
      (!filterType || filterType === 'organization') &&
      userOrgIds.length > 0
    ) {
      const orgsResult = await pool.query<{
        id: string;
        name: string;
        description: string | null;
      }>(
        `SELECT id, name, description FROM organizations
           WHERE LOWER(name) LIKE $1
             AND id = ANY($2)
           ORDER BY name
           LIMIT 10`,
        [searchQuery, userOrgIds]
      );
      for (const row of orgsResult.rows) {
        results.push({
          id: row.id,
          type: 'organization',
          name: row.name,
          description: row.description ?? undefined
        });
      }
    }

    return create(VfsSharesSearchShareTargetsResponseSchema, {
      results: results.map((result) => toShareTargetPayload(result))
    });
  } catch (error) {
    console.error('Failed to search share targets:', error);
    throw new ConnectError('Failed to search', Code.Internal);
  }
}

export async function getSharePolicyPreviewDirect(
  request: {
    rootItemId: string;
    principalType: string;
    principalId: string;
    limit: number;
    cursor: string;
    maxDepth: number;
    q: string;
    objectType: string[];
  },
  context: { requestHeader: Headers }
): Promise<VfsSharesGetSharePolicyPreviewResponse> {
  const claims = await requireVfsSharesClaims(
    '/connect/tearleads.v2.VfsSharesService/GetSharePolicyPreview',
    context.requestHeader
  );

  const rootItemId = request.rootItemId.trim();
  const principalId = request.principalId.trim();
  if (!rootItemId || !principalId) {
    throw new ConnectError(
      'rootItemId and principalId are required',
      Code.InvalidArgument
    );
  }
  if (!isPreviewPrincipalType(request.principalType)) {
    throw new ConnectError(
      'principalType must be user, group, or organization',
      Code.InvalidArgument
    );
  }

  const limit = resolveLimit(request.limit);
  const maxDepth = resolveMaxDepth(request.maxDepth);
  const objectTypes = parseObjectTypeValues(request.objectType);
  const cursor = request.cursor.trim().length > 0 ? request.cursor : null;
  const search = request.q.trim().length > 0 ? request.q : null;

  try {
    const pool = await getPool('read');
    const rootRowResult = await pool.query<{
      owner_id: string | null;
      object_type: string;
    }>(
      `SELECT owner_id, object_type
         FROM vfs_registry
         WHERE id = $1`,
      [rootItemId]
    );

    const rootRow = rootRowResult.rows[0];
    if (!rootRow) {
      throw new ConnectError('Root item not found', Code.NotFound);
    }
    if (rootRow.owner_id !== claims.sub) {
      throw new ConnectError(
        'Not authorized to preview this root container',
        Code.PermissionDenied
      );
    }
    if (!CONTAINER_OBJECT_TYPES.has(rootRow.object_type)) {
      throw new ConnectError(
        'Root item must be a container object type',
        Code.InvalidArgument
      );
    }

    const preview = await buildSharePolicyPreviewTree(pool, {
      rootItemId,
      principalType: request.principalType,
      principalId,
      limit,
      cursor,
      maxDepth,
      search,
      objectTypes
    });

    return toSharePolicyPreviewResponse(preview);
  } catch (error) {
    if (error instanceof ConnectError) {
      throw error;
    }
    console.error('Failed to build share policy preview tree:', error);
    throw new ConnectError('Failed to build share preview', Code.Internal);
  }
}
