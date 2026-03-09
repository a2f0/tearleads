import { create } from '@bufbuild/protobuf';
import { Code, ConnectError } from '@connectrpc/connect';
import type {
  AdminDeleteRedisKeyResponse,
  AdminGetRedisDbSizeResponse,
  AdminGetRedisKeysResponse,
  AdminGetRedisValueResponse,
  AdminRedisKeyInfo,
  AdminRedisValue
} from '@tearleads/shared/gen/tearleads/v2/admin_pb';
import {
  AdminDeleteRedisKeyResponseSchema,
  AdminGetRedisDbSizeResponseSchema,
  AdminGetRedisKeysResponseSchema,
  AdminGetRedisValueResponseSchema,
  AdminRedisKeyInfoSchema,
  AdminRedisValueSchema
} from '@tearleads/shared/gen/tearleads/v2/admin_pb';
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

function toInt64Value(value: number): bigint {
  if (!Number.isFinite(value)) {
    return 0n;
  }
  return BigInt(Math.trunc(value));
}

function toUint64Value(value: number): bigint {
  if (!Number.isFinite(value) || value < 0) {
    return 0n;
  }
  return BigInt(Math.trunc(value));
}

function toRedisValue(
  value: string | string[] | Record<string, string> | null
): AdminRedisValue | undefined {
  if (typeof value === 'string') {
    return create(AdminRedisValueSchema, {
      value: {
        case: 'stringValue',
        value
      }
    });
  }

  if (Array.isArray(value)) {
    return create(AdminRedisValueSchema, {
      value: {
        case: 'listValue',
        value: {
          values: value
        }
      }
    });
  }

  if (value !== null) {
    return create(AdminRedisValueSchema, {
      value: {
        case: 'mapValue',
        value: {
          entries: value
        }
      }
    });
  }

  return undefined;
}

export async function getRedisKeysDirect(
  request: GetRedisKeysRequest,
  context: { requestHeader: Headers }
): Promise<AdminGetRedisKeysResponse> {
  await requireAdminSession('/admin/redis/keys', context.requestHeader);

  try {
    const client = await getRedisClient();
    const result = await client.scan(normalizeCursor(request.cursor), {
      MATCH: '*',
      COUNT: normalizeLimit(request.limit)
    });

    const keyInfos: AdminRedisKeyInfo[] = [];
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
        keyInfos.push(
          create(AdminRedisKeyInfoSchema, {
            key,
            type: String(pipelineResults[index * 2] ?? 'unknown'),
            ttl: toInt64Value(Number(pipelineResults[index * 2 + 1] ?? -1))
          })
        );
      }
    }

    return create(AdminGetRedisKeysResponseSchema, {
      keys: keyInfos,
      cursor: String(result.cursor),
      hasMore: String(result.cursor) !== '0'
    });
  } catch (error) {
    console.error('Redis error:', error);
    throw new ConnectError('Failed to connect to Redis', Code.Internal);
  }
}

export async function getRedisValueDirect(
  request: KeyRequest,
  context: { requestHeader: Headers }
): Promise<AdminGetRedisValueResponse> {
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

    const redisValue = toRedisValue(value);
    return create(AdminGetRedisValueResponseSchema, {
      key: request.key,
      type,
      ttl: toInt64Value(ttl),
      ...(redisValue ? { value: redisValue } : {})
    });
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
): Promise<AdminDeleteRedisKeyResponse> {
  await requireAdminSession(
    `/admin/redis/keys/${encodeURIComponent(request.key)}`,
    context.requestHeader
  );

  try {
    const client = await getRedisClient();
    const deletedCount = await client.del(request.key);
    return create(AdminDeleteRedisKeyResponseSchema, {
      deleted: deletedCount > 0
    });
  } catch (error) {
    console.error('Redis error:', error);
    throw new ConnectError('Failed to connect to Redis', Code.Internal);
  }
}

export async function getRedisDbSizeDirect(
  _request: object,
  context: { requestHeader: Headers }
): Promise<AdminGetRedisDbSizeResponse> {
  await requireAdminSession('/admin/redis/dbsize', context.requestHeader);

  try {
    const client = await getRedisClient();
    const count = await client.dbSize();
    return create(AdminGetRedisDbSizeResponseSchema, {
      count: toUint64Value(count)
    });
  } catch (error) {
    console.error('Redis error:', error);
    throw new ConnectError('Failed to connect to Redis', Code.Internal);
  }
}
