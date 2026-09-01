import pgClient from "@tearleads/api-shared/postgres";
import { closeRedisClient } from "../src/adapters/redis";
import { closeRedisPubSub } from "../src/adapters/redisPubSub";

const cleanupPromiseKey = Symbol.for("tearleads.apiTestCleanupPromise");

type ApiTestCleanupGlobal = typeof globalThis & {
  [cleanupPromiseKey]?: Promise<void>;
};

function isAlreadyClosedError(error: unknown): boolean {
  return error instanceof Error && error.message === "PGlite is closed";
}

export async function closeApiTestAdapters(): Promise<void> {
  const cleanupGlobal = globalThis as ApiTestCleanupGlobal;
  cleanupGlobal[cleanupPromiseKey] ??= (async () => {
    await closeRedisPubSub();
    await closeRedisClient();

    try {
      await pgClient.close();
    } catch (error) {
      if (!isAlreadyClosedError(error)) {
        throw error;
      }
    }
  })();

  await cleanupGlobal[cleanupPromiseKey];
}
