import { createDatabaseWorkerClient } from "@tearleads/sqlite-worker/client";

export type WorkerStatus = "idle" | "ready" | "error";

export function createAppDatabaseWorker() {
  if (typeof Worker === "undefined") {
    throw new Error("Worker must be defined.");
  }

  // Dedicated Web Worker
  const worker = new Worker(new URL("./sqliteWorkerThread.ts", import.meta.url), {
    type: "module",
  });

  return createDatabaseWorkerClient(worker);
}
