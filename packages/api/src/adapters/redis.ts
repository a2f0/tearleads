import { createClient } from "redis";

type RedisClient = ReturnType<typeof createClient>;

let client: RedisClient | null = null;
let connectPromise: Promise<RedisClient> | null = null;

function getClient(): RedisClient {
  if (client) {
    return client;
  }

  const nextClient = createClient();
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
  const activeClient = await ensureClient();
  return activeClient.get(key);
}

export async function set(
  key: string,
  value: string,
  ttlSeconds?: number,
): Promise<void> {
  const activeClient = await ensureClient();
  if (ttlSeconds !== undefined) {
    await activeClient.set(key, value, { EX: ttlSeconds });
  } else {
    await activeClient.set(key, value);
  }
}

export async function setKeepTtl(key: string, value: string): Promise<void> {
  const activeClient = await ensureClient();
  await activeClient.set(key, value, {
    condition: "XX",
    expiration: "KEEPTTL",
  });
}

export async function getdel(key: string): Promise<string | null> {
  const activeClient = await ensureClient();
  return activeClient.getDel(key);
}

export async function del(key: string): Promise<void> {
  const activeClient = await ensureClient();
  await activeClient.del(key);
}

export async function expire(key: string, ttlSeconds: number): Promise<void> {
  const activeClient = await ensureClient();
  await activeClient.expire(key, ttlSeconds);
}

export async function sadd(key: string, member: string): Promise<void> {
  const activeClient = await ensureClient();
  await activeClient.sAdd(key, member);
}

export async function srem(key: string, member: string): Promise<void> {
  const activeClient = await ensureClient();
  await activeClient.sRem(key, member);
}

// Stream Redis set members in bounded batches. This keeps session listing scoped
// to one user's set without materializing the full set or scanning the keyspace.
export async function* sscanMembers(
  key: string,
): AsyncGenerator<string[], void, unknown> {
  const activeClient = await ensureClient();
  yield* activeClient.sScanIterator(key, {
    COUNT: 100,
  });
}

export async function closeRedisClient(): Promise<void> {
  const activeClient = client;
  client = null;
  connectPromise = null;

  if (!activeClient || !activeClient.isOpen) {
    return;
  }

  await activeClient.close();
}
