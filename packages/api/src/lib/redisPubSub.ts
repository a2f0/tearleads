import {
  getRedisSubscriberOverride,
  setRedisSubscriberOverrideForTesting
} from '@tearleads/shared/redis';
import { createClient } from 'redis';

export { setRedisSubscriberOverrideForTesting };

type RedisClient = ReturnType<typeof createClient>;

let subscriberClientPromise: Promise<RedisClient> | null = null;

export async function getRedisSubscriberClient(): Promise<RedisClient> {
  const override = getRedisSubscriberOverride();
  if (override) return override as RedisClient;

  if (!subscriberClientPromise) {
    subscriberClientPromise = (async () => {
      const client = createClient({
        url: process.env['REDIS_URL'] || 'redis://localhost:6379'
      });

      client.on('error', (err) => {
        console.error('Redis subscriber client error:', err);
      });

      await client.connect();
      return client;
    })();
  }

  return subscriberClientPromise;
}

export async function closeRedisSubscriberClient(): Promise<void> {
  if (subscriberClientPromise) {
    const client = await subscriberClientPromise;
    await client.quit();
    subscriberClientPromise = null;
  }
}
