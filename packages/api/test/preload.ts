import { afterAll } from "bun:test";

const apiRedisEnvKey = "API_REDIS";

process.env[apiRedisEnvKey] ??= "memory";

const [{ initializeApiDatabase }, { closeApiTestAdapters }] = await Promise.all(
  [import("../src/adapters/postgres"), import("./cleanup")],
);

await initializeApiDatabase();

afterAll(async () => {
  await closeApiTestAdapters();
});
