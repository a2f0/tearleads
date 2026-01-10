import { getRedisClient } from './redis.js';

export interface BroadcastMessage {
  type: string;
  payload: unknown;
  timestamp: string;
}

export async function broadcast(
  channel: string,
  message: BroadcastMessage
): Promise<number> {
  const client = await getRedisClient();
  return client.publish(channel, JSON.stringify(message));
}
