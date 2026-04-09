import {
  execDatabaseStatement,
  initDatabase,
} from "@tearleads/sqlite-worker/load-sqlite3";
import type {
  WorkerRequest,
  WorkerResponse,
} from "@tearleads/sqlite-worker/types";
import { handleRequest } from "@tearleads/sqlite-worker/worker-core";

let sqliteInitQueue = Promise.resolve();

function runWithBunFetchLock<T>(operation: () => Promise<T>): Promise<T> {
  const nextOperation = sqliteInitQueue.then(async () => {
    const previousFetch = globalThis.fetch;
    globalThis.fetch = Bun.fetch;

    try {
      return await operation();
    } finally {
      globalThis.fetch = previousFetch;
    }
  });

  sqliteInitQueue = nextOperation.then(
    () => undefined,
    () => undefined,
  );

  return nextOperation;
}

// Minimal worker test double for App.tsx. It uses the shared sqlite worker
// protocol so test behavior stays aligned with the real worker contract.
export class MockWorker extends EventTarget {
  db: Awaited<ReturnType<typeof initDatabase>> | null = null;
  terminated = false;

  constructor(_scriptURL?: string | URL, _options?: WorkerOptions) {
    super();
  }

  terminate() {
    this.db?.close();
    this.db = null;
    this.terminated = true;
  }

  postMessage(message: WorkerRequest) {
    queueMicrotask(async () => {
      const response = (await handleRequest(message, {
        onInit: async (options) => {
          if (this.db) {
            throw new Error("Database has already been initialized.");
          }

          this.db = await runWithBunFetchLock(() => initDatabase(options));
        },
        onExec: async (options) => {
          if (!this.db) {
            throw new Error("Database has not been initialized.");
          }

          return execDatabaseStatement(this.db, options);
        },
      })) satisfies WorkerResponse;

      this.dispatchEvent(
        new MessageEvent<WorkerResponse>("message", {
          data: response,
        }),
      );
    });
  }
}
