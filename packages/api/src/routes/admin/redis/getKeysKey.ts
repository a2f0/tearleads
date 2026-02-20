import type { RedisKeyValueResponse } from '@tearleads/shared';
import { getRedisClient } from '@tearleads/shared/redis';
import type { Request, Response, Router as RouterType } from 'express';

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
export const getKeysKeyHandler = async (
  req: Request<{ key: string }>,
  res: Response
) => {
  try {
    const client = await getRedisClient();
    const { key } = req.params;

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
};

export function registerGetKeysKeyRoute(routeRouter: RouterType): void {
  routeRouter.get('/keys/:key', getKeysKeyHandler);
}
