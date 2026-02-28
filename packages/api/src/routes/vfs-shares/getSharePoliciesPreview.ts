import { VFS_CONTAINER_OBJECT_TYPES } from '@tearleads/shared';
import type { Request, Response, Router as RouterType } from 'express';
import { getPool } from '../../lib/postgres.js';
import { buildSharePolicyPreviewTree } from '../../lib/vfsSharePolicyPreviewTree.js';

type PreviewPrincipalType = 'user' | 'group' | 'organization';

interface PreviewQuery {
  rootItemId?: string;
  principalType?: string;
  principalId?: string;
  limit?: string;
  cursor?: string;
  maxDepth?: string;
  q?: string;
  objectType?: string;
}

const CONTAINER_OBJECT_TYPES = new Set<string>(VFS_CONTAINER_OBJECT_TYPES);

function isPreviewPrincipalType(
  value: string | undefined
): value is PreviewPrincipalType {
  return value === 'user' || value === 'group' || value === 'organization';
}

function parsePositiveLimit(raw: string | undefined): number {
  if (!raw) {
    return 100;
  }
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed < 1) {
    throw new Error('limit must be a positive integer');
  }
  return Math.min(parsed, 500);
}

function parseMaxDepth(raw: string | undefined): number | null {
  if (!raw) {
    return null;
  }
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error('maxDepth must be a non-negative integer');
  }
  return parsed;
}

function parseObjectTypes(raw: string | undefined): string[] | null {
  if (!raw) {
    return null;
  }
  return raw
    .split(',')
    .map((value) => value.trim())
    .filter(
      (value, index, array) =>
        value.length > 0 && array.indexOf(value) === index
    );
}

/**
 * @openapi
 * /vfs/share-policies/preview:
 *   get:
 *     summary: Preview effective share policy tree
 *     description: |
 *       Returns a paginated effective tree for a root container/principal pair.
 *       Each node is classified as included, excluded, denied, direct, or derived.
 *     tags:
 *       - VFS Shares
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: rootItemId
 *         required: true
 *         schema:
 *           type: string
 *       - in: query
 *         name: principalType
 *         required: true
 *         schema:
 *           type: string
 *           enum: [user, group, organization]
 *       - in: query
 *         name: principalId
 *         required: true
 *         schema:
 *           type: string
 *       - in: query
 *         name: limit
 *         required: false
 *         schema:
 *           type: integer
 *           minimum: 1
 *           maximum: 500
 *       - in: query
 *         name: cursor
 *         required: false
 *         schema:
 *           type: string
 *       - in: query
 *         name: maxDepth
 *         required: false
 *         schema:
 *           type: integer
 *           minimum: 0
 *       - in: query
 *         name: q
 *         required: false
 *         schema:
 *           type: string
 *       - in: query
 *         name: objectType
 *         required: false
 *         schema:
 *           type: string
 *         description: Comma-separated object type filters.
 *     responses:
 *       200:
 *         description: Effective share preview tree
 *       400:
 *         description: Invalid query
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden
 *       404:
 *         description: Root item not found
 *       500:
 *         description: Server error
 */
const getSharePoliciesPreviewHandler = async (
  req: Request<unknown, unknown, unknown, PreviewQuery>,
  res: Response
) => {
  const claims = req.authClaims;
  if (!claims) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  const rootItemId = req.query.rootItemId?.trim();
  const principalId = req.query.principalId?.trim();
  if (!rootItemId || !principalId) {
    res.status(400).json({
      error: 'rootItemId and principalId are required'
    });
    return;
  }
  if (!isPreviewPrincipalType(req.query.principalType)) {
    res.status(400).json({
      error: 'principalType must be user, group, or organization'
    });
    return;
  }

  let limit: number;
  let maxDepth: number | null;
  try {
    limit = parsePositiveLimit(req.query.limit);
    maxDepth = parseMaxDepth(req.query.maxDepth);
  } catch (error) {
    res.status(400).json({
      error: error instanceof Error ? error.message : 'Invalid query'
    });
    return;
  }

  try {
    const pool = await getPool('read');
    const rootRowResult = await pool.query<{
      owner_id: string | null;
      object_type: string;
    }>(
      `
      SELECT owner_id, object_type
      FROM vfs_registry
      WHERE id = $1
      `,
      [rootItemId]
    );
    const rootRow = rootRowResult.rows[0];
    if (!rootRow) {
      res.status(404).json({ error: 'Root item not found' });
      return;
    }
    if (rootRow.owner_id !== claims.sub) {
      res.status(403).json({
        error: 'Not authorized to preview this root container'
      });
      return;
    }
    if (!CONTAINER_OBJECT_TYPES.has(rootRow.object_type)) {
      res.status(400).json({
        error: 'Root item must be a container object type'
      });
      return;
    }

    const preview = await buildSharePolicyPreviewTree(pool, {
      rootItemId,
      principalType: req.query.principalType,
      principalId,
      limit,
      cursor: req.query.cursor ?? null,
      maxDepth,
      search: req.query.q ?? null,
      objectTypes: parseObjectTypes(req.query.objectType)
    });
    res.json(preview);
  } catch (error) {
    console.error('Failed to build share policy preview tree:', error);
    res.status(500).json({ error: 'Failed to build share preview' });
  }
};

export function registerGetSharePoliciesPreviewRoute(
  routeRouter: RouterType
): void {
  routeRouter.get('/share-policies/preview', getSharePoliciesPreviewHandler);
}
