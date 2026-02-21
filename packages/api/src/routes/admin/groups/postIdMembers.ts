import type { AddMemberRequest } from '@tearleads/shared';
import type { Request, Response, Router as RouterType } from 'express';
import { getPostgresPool } from '../../../lib/postgres.js';
import { ensureOrganizationAccess } from '../../../middleware/adminAccess.js';
import { isDuplicateConstraintError } from '../lib/db.js';
import { getGroupOrganizationId } from './shared.js';

/**
 * @openapi
 * /admin/groups/{id}/members:
 *   post:
 *     summary: Add a member to a group
 *     description: Adds a user to a group
 *     tags:
 *       - Admin
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: The group ID
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - userId
 *             properties:
 *               userId:
 *                 type: string
 *     responses:
 *       201:
 *         description: Member added successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 added:
 *                   type: boolean
 *       400:
 *         description: Invalid request body
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       404:
 *         description: Group or user not found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       409:
 *         description: User already a member
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
const postIdMembersHandler = async (
  req: Request<{ id: string }, unknown, AddMemberRequest>,
  res: Response
) => {
  try {
    const { id } = req.params;
    const { userId } = req.body;

    if (!userId || typeof userId !== 'string') {
      res.status(400).json({ error: 'userId is required' });
      return;
    }

    const pool = await getPostgresPool();

    const organizationId = await getGroupOrganizationId(pool, id);
    if (!organizationId) {
      res.status(404).json({ error: 'Group not found' });
      return;
    }
    if (!ensureOrganizationAccess(req, res, organizationId)) {
      return;
    }

    const userExists = await pool.query('SELECT 1 FROM users WHERE id = $1', [
      userId
    ]);
    if (userExists.rowCount === 0) {
      res.status(404).json({ error: 'User not found' });
      return;
    }

    await pool.query(
      `INSERT INTO user_organizations (user_id, organization_id, joined_at)
         VALUES ($1, $2, $3)
         ON CONFLICT DO NOTHING`,
      [userId, organizationId, new Date()]
    );

    await pool.query(
      `INSERT INTO user_groups (user_id, group_id, joined_at)
         VALUES ($1, $2, $3)`,
      [userId, id, new Date()]
    );

    res.status(201).json({ added: true });
  } catch (err) {
    console.error('Groups error:', err);
    if (isDuplicateConstraintError(err)) {
      res.status(409).json({ error: 'User is already a member of this group' });
      return;
    }
    res.status(500).json({
      error: err instanceof Error ? err.message : 'Failed to add member'
    });
  }
};

export function registerPostIdMembersRoute(routeRouter: RouterType): void {
  routeRouter.post('/:id/members', postIdMembersHandler);
}
