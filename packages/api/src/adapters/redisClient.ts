import { createClient } from "redis";

export function createRedisClient() {
  // Redis 6 defaults to RESP3 and a five-second command timeout. Keep the
  // existing wire protocol and timeout behavior for sessions and realtime.
  return createClient({
    RESP: 2,
    socket: { keepAliveInitialDelay: 5000 },
    commandOptions: { timeout: 0 },
  });
}
