import type { OrganizationUsersResponse } from '@tearleads/shared';
import type { Request, Response, Router as RouterType } from 'express';
import { getPool } from '../../../lib/postgres.js';
import { ensureOrganizationAccess } from '../../../middleware/adminAccess.js';
import { ensureOrganizationExists } from '../lib/organizations.js';

/**
 * @openapi
 * /admin/organizations/{id}/users:
 *   get:
 *     summary: Get users belonging to an organization
 *     description: Returns all users that are members of the specified organization.
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
 *         description: List of organization users
 *       404:
 *         description: Organization not found
 *       500:
 *         description: Database error
 */
const getIdUsersHandler = async (
  req: Request<{ id: string }>,
  res: Response
) => {
  try {
    const { id } = req.params;
    if (!ensureOrganizationAccess(req, res, id)) return;
    const pool = await getPool('read');
    if (!(await ensureOrganizationExists(pool, id, res))) return;

    const result = await pool.query<{
      id: string;
      email: string;
      joined_at: Date;
    }>(
      `SELECT u.id, u.email, uo.joined_at
         FROM users u
         INNER JOIN user_organizations uo ON uo.user_id = u.id
         WHERE uo.organization_id = $1
         ORDER BY u.email`,
      [id]
    );

    const response: OrganizationUsersResponse = {
      users: result.rows.map((row) => ({
        id: row.id,
        email: row.email,
        joinedAt: row.joined_at.toISOString()
      }))
    };
    res.json(response);
  } catch (err) {
    console.error('Organizations error:', err);
    res.status(500).json({
      error:
        err instanceof Error
          ? err.message
          : 'Failed to fetch organization users'
    });
  }
};

export function registerGetIdUsersRoute(routeRouter: RouterType): void {
  routeRouter.get('/:id/users', getIdUsersHandler);
}
