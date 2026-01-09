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
 *     description: Returns all Redis keys with their types and TTLs using non-blocking SCAN
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

    // Use SCAN instead of KEYS to avoid blocking Redis
    const keys: string[] = [];
    for await (const batch of client.scanIterator({ MATCH: '*', COUNT: 100 })) {
      keys.push(...batch);
    }

    // Use pipeline to batch TYPE and TTL commands for efficiency
    const keyInfos: RedisKeyInfo[] = [];

    if (keys.length > 0) {
      const pipeline = client.multi();
      for (const key of keys) {
        pipeline.type(key);
        pipeline.ttl(key);
      }
      const results = await pipeline.exec();

      for (let i = 0; i < keys.length; i++) {
        const key = keys[i];
        if (key !== undefined) {
          keyInfos.push({
            key,
            type: String(results[i * 2] ?? 'unknown'),
            ttl: Number(results[i * 2 + 1] ?? -1)
          });
        }
      }
    }

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
