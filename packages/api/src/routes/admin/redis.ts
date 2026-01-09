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
 *     summary: List Redis keys with pagination
 *     description: Returns Redis keys with their types and TTLs using cursor-based pagination
 *     tags:
 *       - Admin
 *     parameters:
 *       - in: query
 *         name: cursor
 *         schema:
 *           type: string
 *           default: "0"
 *         description: Redis SCAN cursor for pagination
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 50
 *         description: Maximum number of keys to return per page
 *     responses:
 *       200:
 *         description: Paginated list of Redis keys
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
 *                 cursor:
 *                   type: string
 *                   description: Cursor for the next page
 *                 hasMore:
 *                   type: boolean
 *                   description: Whether more keys are available
 *       500:
 *         description: Redis connection error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
router.get('/keys', async (req: Request, res: Response) => {
  try {
    const client = await getRedisClient();
    const cursor = String(req.query['cursor'] ?? '0');
    const limit = Math.min(Number(req.query['limit']) || 50, 100);

    // Use SCAN with cursor for pagination
    const result = await client.scan(cursor, {
      MATCH: '*',
      COUNT: limit
    });
    const nextCursor = String(result.cursor);
    const keys = result.keys;

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

    const response: RedisKeysResponse = {
      keys: keyInfos,
      cursor: nextCursor,
      hasMore: nextCursor !== '0'
    };
    res.json(response);
  } catch (err) {
    console.error('Redis error:', err);
    res.status(500).json({
      error: err instanceof Error ? err.message : 'Failed to connect to Redis'
    });
  }
});

export { router as redisRouter };
