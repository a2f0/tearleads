import type {
  RedisKeyInfo,
  RedisKeysResponse,
  RedisKeyValueResponse
} from '@rapid/shared';
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

/**
 * @openapi
 * /admin/redis/keys/{key}:
 *   get:
 *     summary: Get Redis key value
 *     description: Returns the value of a Redis key based on its type (string, set, hash)
 *     tags:
 *       - Admin
 *     parameters:
 *       - in: path
 *         name: key
 *         required: true
 *         schema:
 *           type: string
 *         description: The Redis key to fetch
 *     responses:
 *       200:
 *         description: Key value retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 key:
 *                   type: string
 *                 type:
 *                   type: string
 *                 ttl:
 *                   type: number
 *                 value:
 *                   oneOf:
 *                     - type: string
 *                     - type: array
 *                       items:
 *                         type: string
 *                     - type: object
 *                       additionalProperties:
 *                         type: string
 *                     - type: 'null'
 *       404:
 *         description: Key not found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       500:
 *         description: Redis connection error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
router.get('/keys/:key', async (req: Request, res: Response) => {
  try {
    const client = await getRedisClient();
    const key = req.params['key'];

    if (!key) {
      res.status(400).json({ error: 'Key parameter is required' });
      return;
    }

    const type = await client.type(key);

    if (type === 'none') {
      res.status(404).json({ error: 'Key not found' });
      return;
    }

    const ttl = await client.ttl(key);
    let value: string | string[] | Record<string, string> | null = null;

    switch (type) {
      case 'string':
        value = await client.get(key);
        break;
      case 'set':
        value = await client.sMembers(key);
        break;
      case 'hash':
        value = await client.hGetAll(key);
        break;
      default:
        value = null;
    }

    const response: RedisKeyValueResponse = {
      key,
      type,
      ttl,
      value
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
