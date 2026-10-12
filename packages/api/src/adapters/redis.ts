import {
  isWorkerEnvironment,
  KEY_VALUE_SET_PAGE_SIZE,
  keyValueStoreStub,
} from "../worker/environment";
import {
  clearInMemoryRedisData,
  inMemoryRedisDel,
  inMemoryRedisExpire,
  inMemoryRedisGet,
  inMemoryRedisGetDel,
  inMemoryRedisSadd,
  inMemoryRedisSet,
  inMemoryRedisSetKeepTtl,
  inMemoryRedisSrem,
  inMemoryRedisSscanMembers,
  isInMemoryRedisEnabled,
} from "./inMemoryRedis";
import { createRedisClient } from "./redisClient";

// Three backends share this key/value surface: the in-memory fake for tests
// and development, the SQLite Durable Object on Workers, and Redis for the Bun
// process. The Durable Object serializes every call, so the atomic operations
// (GETDEL, SET XX KEEPTTL) keep their Redis semantics there.

type RedisClient = ReturnType<typeof createRedisClient>;

let client: RedisClient | null = null;
let connectPromise: Promise<RedisClient> | null = null;

function getClient(): RedisClient {
  if (client) {
    return client;
  }

  const nextClient = createRedisClient();
  nextClient.on("error", (err) => {
    console.error("Redis client error:", err);
  });
  client = nextClient;
  return nextClient;
}

async function ensureClient(): Promise<RedisClient> {
  const activeClient = getClient();
  if (activeClient.isOpen) {
    return activeClient;
  }
  if (connectPromise) {
    return connectPromise;
  }

  connectPromise = activeClient
    .connect()
    .then(() => activeClient)
    .catch((error) => {
      connectPromise = null;
      throw error;
    });

  const connectedClient = await connectPromise;
  connectPromise = null;
  return connectedClient;
}

export async function get(key: string): Promise<string | null> {
  if (isInMemoryRedisEnabled()) {
    return inMemoryRedisGet(key);
  }
  if (isWorkerEnvironment()) {
    return keyValueStoreStub().get(key);
  }

  const activeClient = await ensureClient();
  return activeClient.get(key);
}

export async function set(
  key: string,
  value: string,
  ttlSeconds?: number,
): Promise<void> {
  if (isInMemoryRedisEnabled()) {
    await inMemoryRedisSet(key, value, ttlSeconds);
    return;
  }
  if (isWorkerEnvironment()) {
    await keyValueStoreStub().set(key, value, ttlSeconds);
    return;
  }

  const activeClient = await ensureClient();
  if (ttlSeconds !== undefined) {
    await activeClient.set(key, value, { EX: ttlSeconds });
  } else {
    await activeClient.set(key, value);
  }
}

export async function setKeepTtl(key: string, value: string): Promise<void> {
  if (isInMemoryRedisEnabled()) {
    await inMemoryRedisSetKeepTtl(key, value);
    return;
  }
  if (isWorkerEnvironment()) {
    await keyValueStoreStub().setKeepTtl(key, value);
    return;
  }

  const activeClient = await ensureClient();
  await activeClient.set(key, value, {
    KEEPTTL: true,
    XX: true,
  });
}

export async function getdel(key: string): Promise<string | null> {
  if (isInMemoryRedisEnabled()) {
    return inMemoryRedisGetDel(key);
  }
  if (isWorkerEnvironment()) {
    return keyValueStoreStub().getdel(key);
  }

  const activeClient = await ensureClient();
  return activeClient.getDel(key);
}

export async function del(key: string): Promise<void> {
  if (isInMemoryRedisEnabled()) {
    await inMemoryRedisDel(key);
    return;
  }
  if (isWorkerEnvironment()) {
    await keyValueStoreStub().del(key);
    return;
  }

  const activeClient = await ensureClient();
  await activeClient.del(key);
}

export async function expire(key: string, ttlSeconds: number): Promise<void> {
  if (isInMemoryRedisEnabled()) {
    await inMemoryRedisExpire(key, ttlSeconds);
    return;
  }
  if (isWorkerEnvironment()) {
    await keyValueStoreStub().expire(key, ttlSeconds);
    return;
  }

  const activeClient = await ensureClient();
  await activeClient.expire(key, ttlSeconds);
}

export async function sadd(key: string, member: string): Promise<void> {
  if (isInMemoryRedisEnabled()) {
    await inMemoryRedisSadd(key, member);
    return;
  }
  if (isWorkerEnvironment()) {
    await keyValueStoreStub().sadd(key, member);
    return;
  }

  const activeClient = await ensureClient();
  await activeClient.sAdd(key, member);
}

export async function srem(key: string, member: string): Promise<void> {
  if (isInMemoryRedisEnabled()) {
    await inMemoryRedisSrem(key, member);
    return;
  }
  if (isWorkerEnvironment()) {
    await keyValueStoreStub().srem(key, member);
    return;
  }

  const activeClient = await ensureClient();
  await activeClient.sRem(key, member);
}

/** The page reader the Durable Object exposes over RPC. */
export interface WorkerSetMemberPages {
  smembers(key: string, after: string | null): Promise<string[]>;
}

/**
 * Page a set by member cursor. Callers prune members while iterating (session
 * listing drops expired sessions), so an offset would skip live members.
 */
export async function* collectWorkerSetMembers(
  store: WorkerSetMemberPages,
  key: string,
  pageSize = KEY_VALUE_SET_PAGE_SIZE,
): AsyncGenerator<string[], void, unknown> {
  let after: string | null = null;
  for (;;) {
    const page = await store.smembers(key, after);
    if (page.length === 0) {
      return;
    }
    yield page;
    const last = page[page.length - 1];
    if (page.length < pageSize || last === undefined) {
      return;
    }
    after = last;
  }
}

// Stream Redis set members in bounded batches. This keeps session listing scoped
// to one user's set without materializing the full set or scanning the keyspace.
export async function* sscanMembers(
  key: string,
): AsyncGenerator<string[], void, unknown> {
  if (isInMemoryRedisEnabled()) {
    yield* inMemoryRedisSscanMembers(key);
    return;
  }
  if (isWorkerEnvironment()) {
    yield* collectWorkerSetMembers(keyValueStoreStub(), key);
    return;
  }

  const activeClient = await ensureClient();
  for await (const members of activeClient.sScanIterator(key, {
    COUNT: 100,
  })) {
    yield members;
  }
}

export async function closeRedisClient(): Promise<void> {
  if (isInMemoryRedisEnabled()) {
    clearInMemoryRedisData();
    return;
  }

  const activeClient = client;
  client = null;
  connectPromise = null;

  if (!activeClient?.isOpen) {
    return;
  }

  await activeClient.close();
}
