import {
  createDatabaseWorkerClient,
  type DatabaseWorkerClient,
  type WorkerLike,
} from "./client";

const DEFAULT_DATABASE_WORKER_URL = "/worker.js";

interface TerminableWorkerLike extends WorkerLike {
  terminate(): void;
}

export interface ModuleWorkerLike extends TerminableWorkerLike {}

export interface ModuleWorkerConstructor {
  new (scriptURL: string | URL, options?: WorkerOptions): ModuleWorkerLike;
}

export interface DatabaseRuntime {
  id: string;
  client: DatabaseWorkerClient;
  destroy(): void;
}

export interface CreateModuleDatabaseRuntimeOptions {
  workerConstructor?: ModuleWorkerConstructor;
  workerUrl?: string | URL;
}

function createModuleWorker(
  workerUrl: string | URL,
  workerConstructor: ModuleWorkerConstructor = globalThis.Worker,
): ModuleWorkerLike {
  return new workerConstructor(workerUrl, { type: "module" });
}

export function createDatabaseRuntime(
  worker: TerminableWorkerLike,
): DatabaseRuntime {
  const client = createDatabaseWorkerClient(worker);

  return {
    id: crypto.randomUUID(),
    client,
    destroy() {
      client.destroy();
      worker.terminate();
    },
  };
}

export function createModuleDatabaseRuntime(
  options: CreateModuleDatabaseRuntimeOptions = {},
): DatabaseRuntime {
  if (
    typeof options.workerConstructor === "undefined" &&
    typeof Worker === "undefined"
  ) {
    throw new Error("Worker must be defined.");
  }

  return createDatabaseRuntime(
    createModuleWorker(
      options.workerUrl ?? DEFAULT_DATABASE_WORKER_URL,
      options.workerConstructor,
    ),
  );
}
