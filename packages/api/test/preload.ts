import { afterAll } from "bun:test";

const apiRedisEnvKey = "API_REDIS";

process.env[apiRedisEnvKey] ??= "memory";

const [
  { initializeApiDatabase },
  { clearInMemoryRedisData },
  { closeApiTestAdapters },
] = await Promise.all([
  import("@tearleads/api-shared/postgres"),
  import("../src/adapters/inMemoryRedis"),
  import("./cleanup"),
]);

await initializeApiDatabase();
clearInMemoryRedisData();

afterAll(async () => {
  await closeApiTestAdapters();
});
