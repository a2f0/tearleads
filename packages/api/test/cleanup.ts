import pgClient from "@tearleads/api-shared/postgres";
import { resetKeyValueStore } from "../src/adapters/keyValueStore";
import { resetPubSub } from "../src/adapters/pubSub";

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
    resetPubSub();
    resetKeyValueStore();

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
