import type { GroupMembersResponse } from '@tearleads/shared';
import type { Request, Response, Router as RouterType } from 'express';
import { getPostgresPool } from '../../../lib/postgres.js';
import { ensureOrganizationAccess } from '../../../middleware/adminAccess.js';
import {
  type GroupMemberRow,
  getGroupOrganizationId,
  mapGroupMemberRow
} from './shared.js';

/**
 * @openapi
 * /admin/groups/{id}/members:
 *   get:
 *     summary: Get group members
 *     description: Returns all members of a group
 *     tags:
 *       - Admin
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: The group ID
 *     responses:
 *       200:
 *         description: List of group members
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 members:
 *                   type: array
 *       404:
 *         description: Group not found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       500:
 *         description: Database error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
const getIdMembersHandler = async (
  req: Request<{ id: string }>,
  res: Response
) => {
  try {
    const { id } = req.params;
    const pool = await getPostgresPool();

    const organizationId = await getGroupOrganizationId(pool, id);
    if (!organizationId) {
      res.status(404).json({ error: 'Group not found' });
      return;
    }
    if (!ensureOrganizationAccess(req, res, organizationId)) {
      return;
    }

    const result = await pool.query<GroupMemberRow>(
      `SELECT ug.user_id, u.email, ug.joined_at
         FROM user_groups ug
         JOIN users u ON u.id = ug.user_id
         WHERE ug.group_id = $1
         ORDER BY ug.joined_at`,
      [id]
    );

    const members = result.rows.map(mapGroupMemberRow);

    const response: GroupMembersResponse = { members };
    res.json(response);
  } catch (err) {
    console.error('Groups error:', err);
    res.status(500).json({
      error: err instanceof Error ? err.message : 'Failed to fetch members'
    });
  }
};

export function registerGetIdMembersRoute(routeRouter: RouterType): void {
  routeRouter.get('/:id/members', getIdMembersHandler);
}
