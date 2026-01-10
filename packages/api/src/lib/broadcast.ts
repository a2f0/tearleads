import type { BroadcastMessage } from '@rapid/shared';
import { getRedisClient } from './redis.js';

export type { BroadcastMessage };

export async function broadcast(
  channel: string,
  message: BroadcastMessage
): Promise<number> {
  const client = await getRedisClient();
  return client.publish(channel, JSON.stringify(message));
}
