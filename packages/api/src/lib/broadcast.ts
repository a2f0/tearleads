import type { BroadcastMessage } from '@tearleads/shared';
import { getRedisClient } from '@tearleads/shared/redis';

export type { BroadcastMessage };

export async function broadcast(
  channel: string,
  message: BroadcastMessage
): Promise<number> {
  const client = await getRedisClient();
  return client.publish(channel, JSON.stringify(message));
}
