import { createDatabaseWorkerClient } from "@tearleads/sqlite-worker/client";
import { createModuleWorker } from "./createModuleWorker";
import type { AppDatabaseWorker, ModuleWorkerConstructor } from "./types";

// Default browser-host worker script path. app-web serves the bundled worker
// at this absolute URL, and non-browser hosts should inject a custom
// `createWorker` via AppHostConfig instead of reusing this helper.
const DEFAULT_DATABASE_WORKER_URL = "/worker.js";

// Creates the default browser-host database worker wrapper. It expects the host
// environment to expose the bundled worker entrypoint at `/worker.js`, while
// tests can inject a mock Worker implementation through `workerConstructor`.
export function createAppDatabaseWorker(
  workerConstructor?: ModuleWorkerConstructor,
): AppDatabaseWorker {
  if (
    typeof workerConstructor === "undefined" &&
    typeof Worker === "undefined"
  ) {
    throw new Error("Worker must be defined.");
  }

  const worker = createModuleWorker(
    DEFAULT_DATABASE_WORKER_URL,
    workerConstructor,
  );

  return {
    id: crypto.randomUUID(),
    client: createDatabaseWorkerClient(worker),
    worker,
  };
}
