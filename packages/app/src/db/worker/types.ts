import type { createDatabaseWorkerClient } from "@tearleads/sqlite-worker/client";

export interface ModuleWorkerLike extends EventTarget {
  postMessage(message: unknown): void;
  addEventListener: Worker["addEventListener"];
  removeEventListener: Worker["removeEventListener"];
  terminate(): void;
}

export interface ModuleWorkerConstructor {
  new (scriptURL: string | URL, options?: WorkerOptions): ModuleWorkerLike;
}

export type AppDatabaseClient = ReturnType<typeof createDatabaseWorkerClient>;

export interface AppDatabaseWorker {
  id: string;
  client: AppDatabaseClient;
  worker: ModuleWorkerLike;
}

export type WorkerStatus = "idle" | "ready" | "error" | "terminated";
