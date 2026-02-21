import type { GroupDetailResponse } from '@tearleads/shared';
import type { Request, Response, Router as RouterType } from 'express';
import { getPostgresPool } from '../../../lib/postgres.js';
import { ensureOrganizationAccess } from '../../../middleware/adminAccess.js';
import {
  type GroupMemberRow,
  type GroupRow,
  mapGroupMemberRow,
  mapGroupRow
} from './shared.js';

/**
 * @openapi
 * /admin/groups/{id}:
 *   get:
 *     summary: Get group details with members
 *     description: Returns a group with its members
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
 *         description: Group details with members
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 group:
 *                   type: object
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
const getIdHandler = async (req: Request<{ id: string }>, res: Response) => {
  try {
    const { id } = req.params;
    const pool = await getPostgresPool();

    const groupResult = await pool.query<GroupRow>(
      'SELECT id, organization_id, name, description, created_at, updated_at FROM groups WHERE id = $1',
      [id]
    );

    const groupRow = groupResult.rows[0];
    if (!groupRow) {
      res.status(404).json({ error: 'Group not found' });
      return;
    }
    if (!ensureOrganizationAccess(req, res, groupRow.organization_id)) {
      return;
    }

    const membersResult = await pool.query<GroupMemberRow>(
      `SELECT ug.user_id, u.email, ug.joined_at
       FROM user_groups ug
       JOIN users u ON u.id = ug.user_id
       WHERE ug.group_id = $1
       ORDER BY ug.joined_at`,
      [id]
    );

    const group = mapGroupRow(groupRow);
    const members = membersResult.rows.map(mapGroupMemberRow);

    const response: GroupDetailResponse = { group, members };
    res.json(response);
  } catch (err) {
    console.error('Groups error:', err);
    res.status(500).json({
      error: err instanceof Error ? err.message : 'Failed to fetch group'
    });
  }
};

export function registerGetIdRoute(routeRouter: RouterType): void {
  routeRouter.get('/:id', getIdHandler);
}
