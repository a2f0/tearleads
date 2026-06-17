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
        // Mirror the real worker's graceful close so the runtime's close→terminate
        // teardown path is exercised in app tests too. The in-memory test db has no
        // OPFS handles to release; closing it is the meaningful part.
        onClose: () => {
          this.db?.close();
          this.db = null;
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

// A worker double whose initialization always fails. It models a SQLite worker
// that cannot boot — e.g. on a fresh offline load where the separately-fetched
// `sqlite3.wasm` asset is unavailable and there is no service worker to serve it
// from cache. The worker protocol reports the init failure, which drives
// DatabaseProvider to `status: "error"`, letting tests assert how the UI
// surfaces (or fails to surface) a database boot failure.
export class FailingInitMockWorker extends EventTarget {
  terminated = false;

  constructor(_scriptURL?: string | URL, _options?: WorkerOptions) {
    super();
  }

  terminate() {
    this.terminated = true;
  }

  postMessage(message: WorkerRequest) {
    queueMicrotask(async () => {
      // Mirror the real worker wrapper (registerDatabaseWorker): turn an init
      // failure into an `ok: false` response so the client rejects `init`,
      // rather than letting it escape as an unhandled rejection.
      let response: WorkerResponse;
      try {
        response = await handleRequest(message, {
          onInit: () => {
            throw new Error(
              "Cannot install OPFS sqlite3_vfs: failed to load sqlite3.wasm (simulated offline boot failure).",
            );
          },
          onExec: () => {
            throw new Error("Database has not been initialized.");
          },
        });
      } catch (error) {
        response = {
          id: message.id,
          result: {
            ok: false,
            message: error instanceof Error ? error.message : String(error),
          },
        };
      }

      this.dispatchEvent(
        new MessageEvent<WorkerResponse>("message", {
          data: response,
        }),
      );
    });
  }
}
