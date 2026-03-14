import { create } from '@bufbuild/protobuf';
import { Code, ConnectError } from '@connectrpc/connect';
import type { VfsShareType } from '@tearleads/shared';
import {
  VfsSharePolicyPreviewNodePayloadSchema,
  VfsSharePolicyPreviewSummaryPayloadSchema,
  type VfsSharesGetItemSharesResponse,
  VfsSharesGetItemSharesResponseSchema,
  type VfsSharesGetSharePolicyPreviewResponse,
  VfsSharesGetSharePolicyPreviewResponseSchema,
  type VfsSharesSearchShareTargetsResponse,
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
  buildVfsSharesV2ConnectMethodPath,
  toOrgSharePayload,
  toSharePayload
} from './vfsDirectCrdtRouteHelpers.js';
import {
  type GroupSearchRow,
  normalizePreviewRequest,
  normalizeRequiredString,
  normalizeSearchLimit,
  normalizeSearchType,
  type OrganizationMembershipRow,
  type OrganizationSearchRow,
  type PreviewRootRow,
  type SearchShareTargetsRequest,
  type ShareClaims,
  type SharePolicyPreviewRequest,
  type UserSearchRow
} from './vfsSharesDirectHandlersShared.js';
import { loadOrgShares, loadUserShares } from './vfsSharesDirectQueries.js';
import {
  loadOrgShareAuthorizationContext,
  loadShareAuthorizationContext
} from './vfsSharesDirectShared.js';

export async function requireVfsSharesClaims(
  methodPath: string,
  headers: Headers
): Promise<ShareClaims> {
  const authResult = await authenticate(headers);
  if (!authResult.ok) {
    throw new ConnectError(authResult.error, toConnectCode(authResult.status));
  }

  const membershipResult = await resolveOrganizationMembership(
    methodPath,
    headers,
    authResult.claims.sub
  );
  if (!membershipResult.ok) {
    throw new ConnectError(
      membershipResult.error,
      toConnectCode(membershipResult.status)
    );
  }

  return { sub: authResult.claims.sub };
}

export async function searchShareTargetsDirect(
  request: SearchShareTargetsRequest,
  context: { requestHeader: Headers }
): Promise<VfsSharesSearchShareTargetsResponse> {
  const claims = await requireVfsSharesClaims(
    buildVfsSharesV2ConnectMethodPath('SearchShareTargets'),
    context.requestHeader
  );

  const query = normalizeRequiredString(request.q);
  if (!query) {
    throw new ConnectError('q is required', Code.InvalidArgument);
  }

  const limit = normalizeSearchLimit(request.limit);
  const filterType = normalizeSearchType(request.type);

  try {
    const pool = await getPool('read');
    const organizationResult = await pool.query<OrganizationMembershipRow>(
      `SELECT organization_id
         FROM user_organizations
        WHERE user_id = $1::uuid
        ORDER BY organization_id`,
      [claims.sub]
    );

    const organizationIds = organizationResult.rows
      .map((row) => normalizeRequiredString(row.organization_id))
      .filter((value): value is string => value !== null);

    if (organizationIds.length === 0) {
      return create(VfsSharesSearchShareTargetsResponseSchema, { results: [] });
    }

    const results: Array<{
      id: string;
      type: VfsShareType;
      name: string;
      description?: string;
    }> = [];
    const searchPattern = `%${query}%`;

    if (filterType === null || filterType === 'user') {
      const userResult = await pool.query<UserSearchRow>(
        `SELECT u.id, u.email
           FROM users u
          WHERE u.email ILIKE $1
            AND EXISTS (
              SELECT 1
                FROM user_organizations target_uo
               WHERE target_uo.user_id = u.id
                 AND target_uo.organization_id = ANY($2::uuid[])
            )
          LIMIT $3`,
        [searchPattern, organizationIds, limit - results.length]
      );

      for (const row of userResult.rows) {
        results.push({
          id: row.id,
          type: 'user',
          name: row.email
        });
      }
    }

    if (
      results.length < limit &&
      (filterType === null || filterType === 'group')
    ) {
      const groupResult = await pool.query<GroupSearchRow>(
        `SELECT g.id, g.name, o.name AS org_name
           FROM groups g
           INNER JOIN organizations o ON o.id = g.organization_id
          WHERE g.organization_id = ANY($2::uuid[])
            AND g.name ILIKE $1
          LIMIT $3`,
        [searchPattern, organizationIds, limit - results.length]
      );

      for (const row of groupResult.rows) {
        const description = normalizeRequiredString(row.org_name);
        results.push({
          id: row.id,
          type: 'group',
          name: row.name,
          ...(description ? { description } : {})
        });
      }
    }

    if (
      results.length < limit &&
      (filterType === null || filterType === 'organization')
    ) {
      const orgResult = await pool.query<OrganizationSearchRow>(
        `SELECT o.id, o.name, o.description
           FROM organizations o
          WHERE o.id = ANY($2::uuid[])
            AND o.name ILIKE $1
          LIMIT $3`,
        [searchPattern, organizationIds, limit - results.length]
      );

      for (const row of orgResult.rows) {
        const description = normalizeRequiredString(row.description);
        results.push({
          id: row.id,
          type: 'organization',
          name: row.name,
          ...(description ? { description } : {})
        });
      }
    }

    return create(VfsSharesSearchShareTargetsResponseSchema, {
      results: results.map((result) =>
        create(VfsShareTargetPayloadSchema, {
          id: result.id,
          type: result.type,
          name: result.name,
          ...(result.description ? { description: result.description } : {})
        })
      )
    });
  } catch (error) {
    if (error instanceof ConnectError) {
      throw error;
    }

    console.error('Failed to search share targets:', error);
    throw new ConnectError('Failed to search targets', Code.Internal);
  }
}

export async function getItemSharesDirect(
  request: { itemId: string },
  context: { requestHeader: Headers }
): Promise<VfsSharesGetItemSharesResponse> {
  const claims = await requireVfsSharesClaims(
    buildVfsSharesV2ConnectMethodPath('GetItemShares'),
    context.requestHeader
  );

  const itemId = normalizeRequiredString(request.itemId);
  if (!itemId) {
    throw new ConnectError('itemId is required', Code.InvalidArgument);
  }

  try {
    const pool = await getPool('read');
    const itemResult = await pool.query<{ owner_id: string | null }>(
      `SELECT owner_id
         FROM vfs_registry
        WHERE id = $1::uuid
        LIMIT 1`,
      [itemId]
    );

    const item = itemResult.rows[0];
    if (!item) {
      throw new ConnectError('Item not found', Code.NotFound);
    }
    if (item.owner_id !== claims.sub) {
      throw new ConnectError(
        'Not authorized to view shares for this item',
        Code.PermissionDenied
      );
    }

    const [userShares, orgShares] = await Promise.all([
      loadUserShares(pool, itemId),
      loadOrgShares(pool, itemId)
    ]);

    return create(VfsSharesGetItemSharesResponseSchema, {
      shares: userShares.map((share) => toSharePayload(share)),
      orgShares: orgShares.map((orgShare) => toOrgSharePayload(orgShare))
    });
  } catch (error) {
    if (error instanceof ConnectError) {
      throw error;
    }

    console.error('Failed to get VFS shares:', error);
    throw new ConnectError('Failed to get shares', Code.Internal);
  }
}

export async function getSharePolicyPreviewDirect(
  request: SharePolicyPreviewRequest,
  context: { requestHeader: Headers }
): Promise<VfsSharesGetSharePolicyPreviewResponse> {
  const claims = await requireVfsSharesClaims(
    buildVfsSharesV2ConnectMethodPath('GetSharePolicyPreview'),
    context.requestHeader
  );

  const normalizedRequest = normalizePreviewRequest(request);

  try {
    const pool = await getPool('read');
    const rootResult = await pool.query<PreviewRootRow>(
      `SELECT owner_id, object_type
         FROM vfs_registry
        WHERE id = $1::uuid
        LIMIT 1`,
      [normalizedRequest.rootItemId]
    );

    const rootItem = rootResult.rows[0];
    if (!rootItem) {
      throw new ConnectError('Root item not found', Code.NotFound);
    }
    if (rootItem.owner_id !== claims.sub) {
      throw new ConnectError(
        'Not authorized to preview this share policy',
        Code.PermissionDenied
      );
    }
    if (rootItem.object_type !== 'folder') {
      throw new ConnectError(
        'Share policy previews require a folder root item',
        Code.InvalidArgument
      );
    }

    const result = await buildSharePolicyPreviewTree(pool, {
      rootItemId: normalizedRequest.rootItemId,
      principalType: normalizedRequest.principalType,
      principalId: normalizedRequest.principalId,
      limit: normalizedRequest.limit,
      cursor: normalizedRequest.cursor,
      maxDepth: normalizedRequest.maxDepth,
      search: normalizedRequest.search,
      objectTypes: normalizedRequest.objectTypes
    });

    return create(VfsSharesGetSharePolicyPreviewResponseSchema, {
      nodes: result.nodes.map((node) =>
        create(VfsSharePolicyPreviewNodePayloadSchema, {
          itemId: node.itemId,
          objectType: node.objectType,
          depth: node.depth,
          path: node.path,
          state: node.state,
          ...(node.effectiveAccessLevel
            ? { effectiveAccessLevel: node.effectiveAccessLevel }
            : {}),
          sourcePolicyIds: node.sourcePolicyIds
        })
      ),
      summary: create(VfsSharePolicyPreviewSummaryPayloadSchema, {
        totalMatchingNodes: result.summary.totalMatchingNodes,
        returnedNodes: result.summary.returnedNodes,
        directCount: result.summary.directCount,
        derivedCount: result.summary.derivedCount,
        deniedCount: result.summary.deniedCount,
        includedCount: result.summary.includedCount,
        excludedCount: result.summary.excludedCount
      }),
      ...(result.nextCursor ? { nextCursor: result.nextCursor } : {})
    });
  } catch (error) {
    if (error instanceof ConnectError) {
      throw error;
    }

    console.error('Failed to get share policy preview:', error);
    throw new ConnectError('Failed to get preview', Code.Internal);
  }
}

export async function deleteShareDirect(
  request: { shareId: string },
  context: { requestHeader: Headers }
): Promise<{ deleted: boolean }> {
  const claims = await requireVfsSharesClaims(
    buildVfsSharesV2ConnectMethodPath('DeleteShare'),
    context.requestHeader
  );

  const shareId = normalizeRequiredString(request.shareId);
  if (!shareId) {
    throw new ConnectError('shareId is required', Code.InvalidArgument);
  }

  try {
    const pool = await getPostgresPool();
    const authContext = await loadShareAuthorizationContext(pool, shareId);
    if (!authContext) {
      throw new ConnectError('Share not found', Code.NotFound);
    }
    if (authContext.ownerId !== claims.sub) {
      throw new ConnectError(
        'Not authorized to delete this share',
        Code.PermissionDenied
      );
    }

    const result = await pool.query(
      `UPDATE vfs_acl_entries
         SET revoked_at = NOW()
       WHERE id = $1::uuid
         AND revoked_at IS NULL`,
      [authContext.aclId]
    );

    return { deleted: (result.rowCount ?? 0) > 0 };
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
    buildVfsSharesV2ConnectMethodPath('DeleteOrgShare'),
    context.requestHeader
  );

  const shareId = normalizeRequiredString(request.shareId);
  if (!shareId) {
    throw new ConnectError('shareId is required', Code.InvalidArgument);
  }

  try {
    const pool = await getPostgresPool();
    const authContext = await loadOrgShareAuthorizationContext(pool, shareId);
    if (!authContext) {
      throw new ConnectError('Org share not found', Code.NotFound);
    }
    if (authContext.ownerId !== claims.sub) {
      throw new ConnectError(
        'Not authorized to delete this org share',
        Code.PermissionDenied
      );
    }

    const result = await pool.query(
      `UPDATE vfs_acl_entries
         SET revoked_at = NOW()
       WHERE id = $1::uuid
         AND revoked_at IS NULL`,
      [authContext.aclId]
    );

    return { deleted: (result.rowCount ?? 0) > 0 };
  } catch (error) {
    if (error instanceof ConnectError) {
      throw error;
    }

    console.error('Failed to delete VFS org share:', error);
    throw new ConnectError('Failed to delete org share', Code.Internal);
  }
}
