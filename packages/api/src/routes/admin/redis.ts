import type { RedisKeyInfo, RedisKeysResponse } from '@rapid/shared';
import {
  type Request,
  type Response,
  Router,
  type Router as RouterType
} from 'express';
import { getRedisClient } from '../../lib/redis.js';

const router: RouterType = Router();

/**
 * @openapi
 * /admin/redis/keys:
 *   get:
 *     summary: List all Redis keys
 *     description: Returns all Redis keys with their types and TTLs
 *     tags:
 *       - Admin
 *     responses:
 *       200:
 *         description: List of Redis keys
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 keys:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       key:
 *                         type: string
 *                       type:
 *                         type: string
 *                       ttl:
 *                         type: number
 *       500:
 *         description: Redis connection error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
router.get('/keys', async (_req: Request, res: Response) => {
  try {
    const client = await getRedisClient();
    const keys = await client.keys('*');

    const keyInfos: RedisKeyInfo[] = await Promise.all(
      keys.map(async (key) => ({
        key,
        type: await client.type(key),
        ttl: await client.ttl(key)
      }))
    );

    const response: RedisKeysResponse = { keys: keyInfos };
    res.json(response);
  } catch (err) {
    console.error('Redis error:', err);
    res.status(500).json({
      error: err instanceof Error ? err.message : 'Failed to connect to Redis'
    });
  }
});

export { router as redisRouter };
