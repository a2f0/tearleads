import { createSQLiteRuntime } from "@tearleads/client-sdk/sqlite";
import type { WorkerRequest } from "@tearleads/sqlite-worker/types";
import { MockWorker } from "./mockWorker";

/** Real SQLite WASM files survive worker replacement, without retaining handles. */
export function createPersistedPaneStorage() {
  const paths = new Map<string, string>();
  const workers: MockWorker[] = [];
  const initializedDatabaseNames: string[] = [];
  const closedWorkers = new Set<MockWorker>();
  class RestartWorker extends MockWorker {
    constructor(url?: string | URL, options?: WorkerOptions) {
      super(url, options, paths);
      workers.push(this);
    }
    protected override onRequest(message: WorkerRequest) {
      if (message.method === "init") {
        initializedDatabaseNames.push(message.params.dbName);
      }
      if (message.method === "close") closedWorkers.add(this);
    }
  }
  return {
    closedWorkers,
    initializedDatabaseNames,
    workers,
    createRuntime: () =>
      createSQLiteRuntime({ workerConstructor: RestartWorker }),
  };
}
