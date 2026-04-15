import {
  execDatabaseStatement,
  loadSqlite3,
} from "@tearleads/sqlite-worker/load-sqlite3";
import type {
  WorkerRequest,
  WorkerResponse,
} from "@tearleads/sqlite-worker/types";
import { handleRequest } from "@tearleads/sqlite-worker/worker-core";

type TestDatabase = InstanceType<
  Awaited<ReturnType<typeof loadSqlite3>>["oo1"]["DB"]
>;

async function initTestDatabase(): Promise<TestDatabase> {
  const sqlite3 = await loadSqlite3();

  // App integration tests exercise worker protocol and SQL behavior, not
  // encrypted on-disk persistence, so an isolated in-memory database is enough.
  return new sqlite3.oo1.DB(":memory:");
}

// Minimal worker test double for App.tsx. It uses the shared sqlite worker
// protocol so test behavior stays aligned with the real worker contract.
export class MockWorker extends EventTarget {
  db: TestDatabase | null = null;
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
        onInit: async (_options) => {
          if (this.db) {
            throw new Error("Database has already been initialized.");
          }

          this.db = await initTestDatabase();
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
