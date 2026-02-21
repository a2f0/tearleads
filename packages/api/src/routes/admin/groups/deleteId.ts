import type { Request, Response, Router as RouterType } from 'express';
import { getPostgresPool } from '../../../lib/postgres.js';
import { ensureOrganizationAccess } from '../../../middleware/adminAccess.js';
import { getGroupOrganizationId } from './shared.js';

/**
 * @openapi
 * /admin/groups/{id}:
 *   delete:
 *     summary: Delete a group
 *     description: Deletes a group and all its memberships
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
 *         description: Group deleted successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 deleted:
 *                   type: boolean
 *       500:
 *         description: Database error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
const deleteIdHandler = async (req: Request<{ id: string }>, res: Response) => {
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

    const result = await pool.query('DELETE FROM groups WHERE id = $1', [id]);
    res.json({ deleted: result.rowCount !== null && result.rowCount > 0 });
  } catch (err) {
    console.error('Groups error:', err);
    res.status(500).json({
      error: err instanceof Error ? err.message : 'Failed to delete group'
    });
  }
};

export function registerDeleteIdRoute(routeRouter: RouterType): void {
  routeRouter.delete('/:id', deleteIdHandler);
}
