import { createClient } from "redis";

export function createRedisClient() {
  // Redis 6 defaults to RESP3 and a five-second command timeout. Keep the
  // existing wire protocol and timeout behavior for sessions and realtime.
  // Zero disables the queue's `if (timeout)` deadline and satisfies its numeric
  // option type under exactOptionalPropertyTypes (unlike explicit undefined).
  // Verified with real Redis session expiry, KEEPTTL, and pub/sub smoke tests.
  // https://github.com/redis/node-redis/blob/redis%406.2.1/packages/client/lib/client/commands-queue.ts
  return createClient({
    RESP: 2,
    socket: { keepAliveInitialDelay: 5000 },
    commandOptions: { timeout: 0 },
  });
}
