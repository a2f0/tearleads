import { type Request, type Response, type Router as RouterType } from 'express';
import { getPostgresPool } from '../../../lib/postgres.js';

/**
 * @openapi
 * /admin/groups/{id}/members/{userId}:
 *   delete:
 *     summary: Remove a member from a group
 *     description: Removes a user from a group
 *     tags:
 *       - Admin
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: The group ID
 *       - in: path
 *         name: userId
 *         required: true
 *         schema:
 *           type: string
 *         description: The user ID
 *     responses:
 *       200:
 *         description: Member removed successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 removed:
 *                   type: boolean
 *       500:
 *         description: Database error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
export const deleteIdMembersUseridHandler = async (
  req: Request<{ id: string; userId: string }>,
  res: Response
) => {
  try {
    const { id, userId } = req.params;
    const pool = await getPostgresPool();

    const result = await pool.query(
      'DELETE FROM user_groups WHERE group_id = $1 AND user_id = $2',
      [id, userId]
    );

    res.json({ removed: result.rowCount !== null && result.rowCount > 0 });
  } catch (err) {
    console.error('Groups error:', err);
    res.status(500).json({
      error: err instanceof Error ? err.message : 'Failed to remove member'
    });
  }
};

export function registerDeleteIdMembersUseridRoute(
  routeRouter: RouterType
): void {
  routeRouter.delete('/:id/members/:userId', deleteIdMembersUseridHandler);
}
