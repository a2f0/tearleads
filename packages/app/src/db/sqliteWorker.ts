import { createDatabaseWorkerClient } from "@tearleads/sqlite-worker/client";

export type WorkerStatus = "idle" | "ready" | "error";

export function createAppDatabaseWorker() {
  if (typeof Worker === "undefined") {
    throw new Error("Worker must be defined.");
  }

  // Dedicated Web Worker
  const worker = new Worker("/src/db/sqliteWorkerThread.ts", {
    type: "module",
  });

  return createDatabaseWorkerClient(worker);
}
