import { type Request, type Response, type Router as RouterType } from 'express';
import { getPostgresPool } from '../../../lib/postgres.js';

/**
 * @openapi
 * /admin/organizations/{id}:
 *   delete:
 *     summary: Delete an organization
 *     description: Deletes an organization and its memberships.
 *     tags:
 *       - Admin
 *     responses:
 *       200:
 *         description: Organization deleted successfully
 *       500:
 *         description: Database error
 */
export const deleteIdHandler = async (
  req: Request<{ id: string }>,
  res: Response
) => {
  try {
    const { id } = req.params;
    const pool = await getPostgresPool();

    const result = await pool.query('DELETE FROM organizations WHERE id = $1', [
      id
    ]);
    res.json({ deleted: result.rowCount !== null && result.rowCount > 0 });
  } catch (err) {
    console.error('Organizations error:', err);
    res.status(500).json({
      error:
        err instanceof Error ? err.message : 'Failed to delete organization'
    });
  }
};

export function registerDeleteIdRoute(routeRouter: RouterType): void {
  routeRouter.delete('/:id', deleteIdHandler);
}
