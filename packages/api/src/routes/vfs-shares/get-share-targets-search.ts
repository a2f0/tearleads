import type {
  ShareTargetSearchResponse,
  ShareTargetSearchResult,
  VfsShareType
} from '@rapid/shared';
import type { Request, Response, Router as RouterType } from 'express';
import { getPostgresPool } from '../../lib/postgres.js';
import { isValidShareType } from './shared.js';

/**
 * @openapi
 * /vfs/share-targets/search:
 *   get:
 *     summary: Search for share targets
 *     description: Search users, groups, or organizations to share with.
 *     tags:
 *       - VFS Shares
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: q
 *         required: true
 *         schema:
 *           type: string
 *         description: Search query
 *       - in: query
 *         name: type
 *         required: false
 *         schema:
 *           type: string
 *           enum: [user, group, organization]
 *         description: Filter by target type
 *     responses:
 *       200:
 *         description: Search results
 *       400:
 *         description: Invalid query
 *       401:
 *         description: Unauthorized
 *       500:
 *         description: Server error
 */
export const getShareTargetsSearchHandler = async (
  req: Request<unknown, unknown, unknown, { q?: string; type?: string }>,
  res: Response
) => {
  const claims = req.authClaims;
  if (!claims) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  const { q, type } = req.query;

  if (!q || typeof q !== 'string' || q.trim().length < 1) {
    res.status(400).json({ error: 'Search query is required' });
    return;
  }

  const searchQuery = `%${q.trim().toLowerCase()}%`;
  const filterType: VfsShareType | null =
    type && isValidShareType(type) ? type : null;

  try {
    const pool = await getPostgresPool();
    const results: ShareTargetSearchResult[] = [];

    if (!filterType || filterType === 'user') {
      const usersResult = await pool.query<{ id: string; email: string }>(
        `SELECT id, email FROM users
           WHERE LOWER(email) LIKE $1
           ORDER BY email
           LIMIT 10`,
        [searchQuery]
      );
      for (const row of usersResult.rows) {
        results.push({
          id: row.id,
          type: 'user',
          name: row.email
        });
      }
    }

    if (!filterType || filterType === 'group') {
      const groupsResult = await pool.query<{
        id: string;
        name: string;
        org_name: string | null;
      }>(
        `SELECT g.id, g.name, o.name AS org_name
           FROM groups g
           LEFT JOIN organizations o ON o.id = g.organization_id
           WHERE LOWER(g.name) LIKE $1
           ORDER BY g.name
           LIMIT 10`,
        [searchQuery]
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

    if (!filterType || filterType === 'organization') {
      const orgsResult = await pool.query<{
        id: string;
        name: string;
        description: string | null;
      }>(
        `SELECT id, name, description FROM organizations
           WHERE LOWER(name) LIKE $1
           ORDER BY name
           LIMIT 10`,
        [searchQuery]
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

    const response: ShareTargetSearchResponse = { results };
    res.json(response);
  } catch (error) {
    console.error('Failed to search share targets:', error);
    res.status(500).json({ error: 'Failed to search' });
  }
};

export function registerGetShareTargetsSearchRoute(
  routeRouter: RouterType
): void {
  routeRouter.get('/share-targets/search', getShareTargetsSearchHandler);
}
