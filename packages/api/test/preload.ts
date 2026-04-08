import { afterAll } from "bun:test";
import pgClient from "../src/adapters/postgres";
import { closeRedisClient } from "../src/adapters/redis";
import { closeRedisPubSub } from "../src/adapters/redisPubSub";

afterAll(async () => {
  await closeRedisPubSub();
  await closeRedisClient();
  await pgClient.close();
});
