import { createDatabaseWorkerClient } from "@tearleads/sqlite-worker/client";
import {
  createModuleWorker,
  type ModuleWorkerConstructor,
  type ModuleWorkerLike,
} from "./createModuleWorker";

export type WorkerStatus = "idle" | "ready" | "error";

export interface AppDatabaseWorker {
  client: ReturnType<typeof createDatabaseWorkerClient>;
  worker: ModuleWorkerLike;
}

export function createAppDatabaseWorker(
  WorkerCtor?: ModuleWorkerConstructor,
): AppDatabaseWorker {
  if (typeof WorkerCtor === "undefined" && typeof Worker === "undefined") {
    throw new Error("Worker must be defined.");
  }

  const worker = createModuleWorker(
    new URL("./sqliteWorkerThread.ts", import.meta.url),
    WorkerCtor,
  );

  return {
    client: createDatabaseWorkerClient(worker as unknown as Worker),
    worker,
  };
}
