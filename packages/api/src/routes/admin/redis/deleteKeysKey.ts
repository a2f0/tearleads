import { getRedisClient } from '@tearleads/shared/redis';
import type { Request, Response, Router as RouterType } from 'express';

/**
 * @openapi
 * /admin/redis/keys/{key}:
 *   delete:
 *     summary: Delete a Redis key
 *     description: Deletes a key from Redis
 *     tags:
 *       - Admin
 *     parameters:
 *       - in: path
 *         name: key
 *         required: true
 *         schema:
 *           type: string
 *         description: The Redis key to delete
 *     responses:
 *       200:
 *         description: Key deletion result
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 deleted:
 *                   type: boolean
 *                   description: Whether the key was deleted
 *       500:
 *         description: Redis connection error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
const deleteKeysKeyHandler = async (
  req: Request<{ key: string }>,
  res: Response
) => {
  try {
    const client = await getRedisClient();
    const { key } = req.params;
    const deletedCount = await client.del(key);
    res.json({ deleted: deletedCount > 0 });
  } catch (err) {
    console.error('Redis error:', err);
    res.status(500).json({
      error: err instanceof Error ? err.message : 'Failed to connect to Redis'
    });
  }
};

export function registerDeleteKeysKeyRoute(routeRouter: RouterType): void {
  routeRouter.delete('/keys/:key', deleteKeysKeyHandler);
}
