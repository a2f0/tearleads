import { createClient, type RedisClientType } from 'redis';

let client: RedisClientType | null = null;

export async function getRedisClient(): Promise<RedisClientType> {
  if (!client) {
    client = createClient({
      url: process.env['REDIS_URL'] || 'redis://localhost:6379'
    });

    client.on('error', (err) => {
      console.error('Redis client error:', err);
    });

    await client.connect();
  }

  return client;
}

export async function closeRedisClient(): Promise<void> {
  if (client) {
    await client.quit();
    client = null;
  }
}
