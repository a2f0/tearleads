import type { OrganizationGroupsResponse } from '@tearleads/shared';
import type { Request, Response, Router as RouterType } from 'express';
import { getPostgresPool } from '../../../lib/postgres.js';
import { ensureOrganizationAccess } from '../../../middleware/adminAccess.js';
import { ensureOrganizationExists } from '../lib/organizations.js';

/**
 * @openapi
 * /admin/organizations/{id}/groups:
 *   get:
 *     summary: Get groups belonging to an organization
 *     description: Returns all groups that belong to the specified organization.
 *     tags:
 *       - Admin
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Organization ID
 *     responses:
 *       200:
 *         description: List of organization groups
 *       404:
 *         description: Organization not found
 *       500:
 *         description: Database error
 */
const getIdGroupsHandler = async (
  req: Request<{ id: string }>,
  res: Response
) => {
  try {
    const { id } = req.params;
    if (!ensureOrganizationAccess(req, res, id)) return;
    const pool = await getPostgresPool();
    if (!(await ensureOrganizationExists(pool, id, res))) return;

    const result = await pool.query<{
      id: string;
      name: string;
      description: string | null;
      member_count: number;
    }>(
      `SELECT g.id, g.name, g.description, COUNT(ug.user_id)::integer AS member_count
         FROM groups g
         LEFT JOIN user_groups ug ON ug.group_id = g.id
         WHERE g.organization_id = $1
         GROUP BY g.id
         ORDER BY g.name`,
      [id]
    );

    const response: OrganizationGroupsResponse = {
      groups: result.rows.map((row) => ({
        id: row.id,
        name: row.name,
        description: row.description,
        memberCount: row.member_count
      }))
    };
    res.json(response);
  } catch (err) {
    console.error('Organizations error:', err);
    res.status(500).json({
      error:
        err instanceof Error
          ? err.message
          : 'Failed to fetch organization groups'
    });
  }
};

export function registerGetIdGroupsRoute(routeRouter: RouterType): void {
  routeRouter.get('/:id/groups', getIdGroupsHandler);
}
