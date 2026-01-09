import { createClient } from 'redis';

type RedisClient = ReturnType<typeof createClient>;

let clientPromise: Promise<RedisClient> | null = null;

export async function getRedisClient(): Promise<RedisClient> {
  if (!clientPromise) {
    clientPromise = (async () => {
      const client = createClient({
        url: process.env['REDIS_URL'] || 'redis://localhost:6379'
      });

      client.on('error', (err) => {
        console.error('Redis client error:', err);
      });

      await client.connect();
      return client;
    })();
  }

  return clientPromise;
}

export async function closeRedisClient(): Promise<void> {
  if (clientPromise) {
    const client = await clientPromise;
    await client.quit();
    clientPromise = null;
  }
}
