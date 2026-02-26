import { createClient } from 'redis';

export type RedisClient = ReturnType<typeof createClient>;

let clientPromise: Promise<RedisClient> | null = null;
let currentUrl: string | null = null;
let mutex: Promise<void> = Promise.resolve();

let clientOverride: RedisClient | null = null;

export function setRedisClientOverrideForTesting(
  override: RedisClient | null
): void {
  clientOverride = override;
}

export async function getRedisClient(url?: string): Promise<RedisClient> {
  if (clientOverride) return clientOverride;

  const redisUrl = url ?? process.env['REDIS_URL'] ?? 'redis://localhost:6379';

  let resolveRelease: () => void = () => {};
  const release = new Promise<void>((resolve) => {
    resolveRelease = resolve;
  });
  const previousMutex = mutex;
  mutex = release;

  await previousMutex;

  try {
    if (clientPromise && currentUrl === redisUrl) {
      return clientPromise;
    }

    if (clientPromise && currentUrl !== redisUrl) {
      const oldClient = await clientPromise;
      await oldClient.quit();
      clientPromise = null;
      currentUrl = null;
    }

    currentUrl = redisUrl;
    clientPromise = (async () => {
      const client = createClient({ url: redisUrl });

      client.on('error', (err: Error) => {
        console.error('Redis client error:', err);
      });

      await client.connect();
      return client;
    })();

    return clientPromise;
  } finally {
    resolveRelease();
  }
}

let subscriberOverride: RedisClient | null = null;

export function setRedisSubscriberOverrideForTesting(
  override: RedisClient | null
): void {
  subscriberOverride = override;
}

export function getRedisSubscriberOverride(): RedisClient | null {
  return subscriberOverride;
}

export async function closeRedisClient(): Promise<void> {
  let resolveRelease: () => void = () => {};
  const release = new Promise<void>((resolve) => {
    resolveRelease = resolve;
  });
  const previousMutex = mutex;
  mutex = release;

  await previousMutex;

  try {
    if (clientPromise) {
      const client = await clientPromise;
      await client.quit();
      clientPromise = null;
      currentUrl = null;
    }
  } finally {
    resolveRelease();
  }
}
