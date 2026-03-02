import { Code, ConnectError } from '@connectrpc/connect';
import type {
  RedisKeyInfo,
  RedisKeysResponse,
  RedisKeyValueResponse
} from '@tearleads/shared';
import { getRedisClient } from '@tearleads/shared/redis';
import { requireAdminSession } from './adminDirectAuth.js';

type GetRedisKeysRequest = { cursor: string; limit: number };
type KeyRequest = { key: string };

function normalizeCursor(cursor: string): string {
  return cursor.trim().length > 0 ? cursor : '0';
}

function normalizeLimit(limit: number): number {
  if (!Number.isFinite(limit) || limit <= 0) {
    return 50;
  }
  return Math.min(Math.floor(limit), 100);
}

export async function getRedisKeysDirect(
  request: GetRedisKeysRequest,
  context: { requestHeader: Headers }
): Promise<{ json: string }> {
  await requireAdminSession('/admin/redis/keys', context.requestHeader);

  try {
    const client = await getRedisClient();
    const result = await client.scan(normalizeCursor(request.cursor), {
      MATCH: '*',
      COUNT: normalizeLimit(request.limit)
    });

    const keyInfos: RedisKeyInfo[] = [];
    if (result.keys.length > 0) {
      const pipeline = client.multi();
      for (const key of result.keys) {
        pipeline.type(key);
        pipeline.ttl(key);
      }
      const pipelineResults = (await pipeline.exec()) ?? [];

      for (let index = 0; index < result.keys.length; index += 1) {
        const key = result.keys[index];
        if (key === undefined) {
          continue;
        }
        keyInfos.push({
          key,
          type: String(pipelineResults[index * 2] ?? 'unknown'),
          ttl: Number(pipelineResults[index * 2 + 1] ?? -1)
        });
      }
    }

    const response: RedisKeysResponse = {
      keys: keyInfos,
      cursor: String(result.cursor),
      hasMore: String(result.cursor) !== '0'
    };
    return { json: JSON.stringify(response) };
  } catch (error) {
    console.error('Redis error:', error);
    throw new ConnectError('Failed to connect to Redis', Code.Internal);
  }
}

export async function getRedisValueDirect(
  request: KeyRequest,
  context: { requestHeader: Headers }
): Promise<{ json: string }> {
  await requireAdminSession(
    `/admin/redis/keys/${encodeURIComponent(request.key)}`,
    context.requestHeader
  );

  try {
    const client = await getRedisClient();
    const type = await client.type(request.key);
    if (type === 'none') {
      throw new ConnectError('Key not found', Code.NotFound);
    }

    const ttl = await client.ttl(request.key);
    let value: string | string[] | Record<string, string> | null = null;

    if (type === 'string') {
      value = await client.get(request.key);
    } else if (type === 'set') {
      value = await client.sMembers(request.key);
    } else if (type === 'hash') {
      value = await client.hGetAll(request.key);
    }

    const response: RedisKeyValueResponse = {
      key: request.key,
      type,
      ttl,
      value
    };
    return { json: JSON.stringify(response) };
  } catch (error) {
    if (error instanceof ConnectError) {
      throw error;
    }
    console.error('Redis error:', error);
    throw new ConnectError('Failed to connect to Redis', Code.Internal);
  }
}

export async function deleteRedisKeyDirect(
  request: KeyRequest,
  context: { requestHeader: Headers }
): Promise<{ json: string }> {
  await requireAdminSession(
    `/admin/redis/keys/${encodeURIComponent(request.key)}`,
    context.requestHeader
  );

  try {
    const client = await getRedisClient();
    const deletedCount = await client.del(request.key);
    return {
      json: JSON.stringify({
        deleted: deletedCount > 0
      })
    };
  } catch (error) {
    console.error('Redis error:', error);
    throw new ConnectError('Failed to connect to Redis', Code.Internal);
  }
}

export async function getRedisDbSizeDirect(
  _request: object,
  context: { requestHeader: Headers }
): Promise<{ json: string }> {
  await requireAdminSession('/admin/redis/dbsize', context.requestHeader);

  try {
    const client = await getRedisClient();
    const count = await client.dbSize();
    return { json: JSON.stringify({ count }) };
  } catch (error) {
    console.error('Redis error:', error);
    throw new ConnectError('Failed to connect to Redis', Code.Internal);
  }
}
