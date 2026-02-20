import { getRedisClient } from '@tearleads/shared/redis';
import type { Request, Response, Router as RouterType } from 'express';

/**
 * @openapi
 * /admin/redis/dbsize:
 *   get:
 *     summary: Get total number of keys in Redis
 *     description: Returns the total count of keys in the current Redis database
 *     tags:
 *       - Admin
 *     responses:
 *       200:
 *         description: Total key count
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 count:
 *                   type: number
 *                   description: Total number of keys in the database
 *       500:
 *         description: Redis connection error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
export const getDbsizeHandler = async (_req: Request, res: Response) => {
  try {
    const client = await getRedisClient();
    const count = await client.dbSize();
    res.json({ count });
  } catch (err) {
    console.error('Redis error:', err);
    res.status(500).json({
      error: err instanceof Error ? err.message : 'Failed to connect to Redis'
    });
  }
};

export function registerGetDbsizeRoute(routeRouter: RouterType): void {
  routeRouter.get('/dbsize', getDbsizeHandler);
}
