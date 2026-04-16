import { createDatabaseWorkerClient } from "@tearleads/sqlite-worker/client";
import { createModuleWorker } from "./createModuleWorker";
import type { AppDatabaseWorker, ModuleWorkerConstructor } from "./types";

// Creates the app's main-thread database worker wrapper. In production it
// loads the bundled worker entrypoint at `/worker.js`, while tests can inject a
// mock Worker implementation through `workerConstructor`.
export function createAppDatabaseWorker(
  workerConstructor?: ModuleWorkerConstructor,
): AppDatabaseWorker {
  if (
    typeof workerConstructor === "undefined" &&
    typeof Worker === "undefined"
  ) {
    throw new Error("Worker must be defined.");
  }

  const worker = createModuleWorker("/worker.js", workerConstructor);

  return {
    id: crypto.randomUUID(),
    client: createDatabaseWorkerClient(worker),
    worker,
  };
}
