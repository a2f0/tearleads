import type { Request, Response, Router as RouterType } from 'express';
import { getPostgresPool } from '../../lib/postgres.js';

/**
 * @openapi
 * /mls/key-packages/{id}:
 *   delete:
 *     summary: Delete an unused key package
 *     tags:
 *       - MLS
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       204:
 *         description: Key package deleted
 */
const deleteKeyPackagesIdHandler = async (req: Request, res: Response) => {
  const claims = req.authClaims;
  if (!claims) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  const idParam = req.params['id'];
  if (!idParam || typeof idParam !== 'string') {
    res.status(400).json({ error: 'id is required' });
    return;
  }
  const id = idParam;

  try {
    const pool = await getPostgresPool();
    const result = await pool.query(
      `DELETE FROM mls_key_packages
       WHERE id = $1 AND user_id = $2 AND consumed_at IS NULL`,
      [id, claims.sub]
    );

    if (result.rowCount === 0) {
      res
        .status(404)
        .json({ error: 'Key package not found or already consumed' });
      return;
    }

    res.status(204).send();
  } catch (error) {
    console.error('Failed to delete key package:', error);
    res.status(500).json({ error: 'Failed to delete key package' });
  }
};

export function registerDeleteKeyPackagesIdRoute(
  routeRouter: RouterType
): void {
  routeRouter.delete('/key-packages/:id', deleteKeyPackagesIdHandler);
}
