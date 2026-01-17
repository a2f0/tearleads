import { createClient } from 'redis';

export type RedisClient = ReturnType<typeof createClient>;

let clientPromise: Promise<RedisClient> | null = null;
let currentUrl: string | null = null;

export async function getRedisClient(
  url?: string
): Promise<RedisClient> {
  const redisUrl = url ?? process.env['REDIS_URL'] ?? 'redis://localhost:6379';

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
}

export async function closeRedisClient(): Promise<void> {
  if (clientPromise) {
    const client = await clientPromise;
    await client.quit();
    clientPromise = null;
    currentUrl = null;
  }
}
