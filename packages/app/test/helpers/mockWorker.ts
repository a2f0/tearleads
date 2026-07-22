import {
  execDatabaseStatement,
  loadSqlite3,
} from "@tearleads/sqlite-worker/load-sqlite3";
import type {
  WorkerRequest,
  WorkerResponse,
} from "@tearleads/sqlite-worker/types";
import { WORKER_CONNECT_PORT_MESSAGE_TYPE } from "@tearleads/sqlite-worker/types";
import { handleRequest } from "@tearleads/sqlite-worker/worker-core";

type TestDatabase = InstanceType<
  Awaited<ReturnType<typeof loadSqlite3>>["oo1"]["DB"]
>;
type TestSqlite3 = Awaited<ReturnType<typeof loadSqlite3>>;

interface MockWorkerConnection {
  db: TestDatabase | null;
  readonly port: MessagePort | null;
}

class MockMessagePort extends EventTarget {
  closed = false;
  peer: MockMessagePort | null = null;

  close() {
    this.closed = true;
  }

  postMessage(message: unknown) {
    const peer = this.peer;
    if (this.closed || !peer || peer.closed) {
      return;
    }

    queueMicrotask(() => {
      if (!this.closed && !peer.closed) {
        peer.dispatchEvent(new MessageEvent("message", { data: message }));
      }
    });
  }

  start() {}
}

export class MockMessageChannel {
  readonly port1 = new MockMessagePort();
  readonly port2 = new MockMessagePort();

  constructor() {
    this.port1.peer = this.port2;
    this.port2.peer = this.port1;
  }
}

let sqlite3ForTestPromise: Promise<TestSqlite3> | null = null;

async function loadSqlite3ForTest() {
  if (sqlite3ForTestPromise) {
    return sqlite3ForTestPromise;
  }

  const originalConsoleWarn = console.warn;
  sqlite3ForTestPromise = (async () => {
    console.warn = (...args: unknown[]) => {
      const isExpectedMainThreadOpfsWarning =
        args[0] === "Ignoring inability to install OPFS sqlite3_vfs:" &&
        String(args[1]).includes(
          "The OPFS sqlite3_vfs cannot run in the main thread",
        );
      if (isExpectedMainThreadOpfsWarning) {
        return;
      }

      originalConsoleWarn(...args);
    };

    try {
      return await loadSqlite3();
    } finally {
      console.warn = originalConsoleWarn;
    }
  })().catch((error: unknown) => {
    sqlite3ForTestPromise = null;
    throw error;
  });

  return sqlite3ForTestPromise;
}

async function initTestDatabase(): Promise<TestDatabase> {
  const sqlite3 = await loadSqlite3ForTest();

  // App integration tests exercise worker protocol and SQL behavior, not
  // encrypted on-disk persistence, so an isolated in-memory database is enough.
  return new sqlite3.oo1.DB(":memory:");
}

function isWorkerRequest(value: unknown): value is WorkerRequest {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const id = Reflect.get(value, "id");
  const method = Reflect.get(value, "method");
  return (
    typeof id === "number" &&
    (method === "ping" ||
      method === "init" ||
      method === "exec" ||
      method === "close" ||
      method === "delete")
  );
}

function isConnectPortMessage(value: unknown): boolean {
  return (
    typeof value === "object" &&
    value !== null &&
    Reflect.get(value, "type") === WORKER_CONNECT_PORT_MESSAGE_TYPE
  );
}

function isMessagePort(value: unknown): value is MessagePort {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof Reflect.get(value, "addEventListener") === "function" &&
    typeof Reflect.get(value, "close") === "function" &&
    typeof Reflect.get(value, "postMessage") === "function" &&
    typeof Reflect.get(value, "start") === "function"
  );
}

// Minimal worker test double for App.tsx. It uses the shared sqlite worker
// protocol so test behavior stays aligned with the real worker contract.
export class MockWorker extends EventTarget {
  private readonly directConnection: MockWorkerConnection = {
    db: null,
    port: null,
  };
  private readonly connections = new Set<MockWorkerConnection>([
    this.directConnection,
  ]);
  terminated = false;

  constructor(_scriptURL?: string | URL, _options?: WorkerOptions) {
    super();
  }

  terminate() {
    for (const connection of this.connections) {
      connection.db?.close();
      connection.db = null;
      connection.port?.close();
    }
    this.connections.clear();
    this.terminated = true;
  }

  postMessage(message: unknown, transfer?: Transferable[]) {
    if (isConnectPortMessage(message)) {
      const port = transfer?.[0];
      if (!isMessagePort(port)) {
        throw new Error("Expected a transferred database client port.");
      }

      const connection: MockWorkerConnection = { db: null, port };
      this.connections.add(connection);
      port.addEventListener("message", (event) => {
        this.handleMessage(connection, Reflect.get(event, "data"));
      });
      port.start();
      return;
    }

    this.handleMessage(this.directConnection, message);
  }

  protected onRequest(_message: WorkerRequest) {}

  private handleMessage(connection: MockWorkerConnection, message: unknown) {
    if (!isWorkerRequest(message)) {
      return;
    }
    this.onRequest(message);

    queueMicrotask(async () => {
      let response: WorkerResponse;
      try {
        response = await handleRequest(message, {
          onInit: async (_options) => {
            if (connection.db) {
              throw new Error("Database has already been initialized.");
            }

            connection.db = await initTestDatabase();
          },
          onExec: async (options) => {
            if (!connection.db) {
              throw new Error("Database has not been initialized.");
            }

            return execDatabaseStatement(connection.db, options);
          },
          // Mirror the real worker's graceful close so the runtime's close→terminate
          // teardown path is exercised in app tests too. The in-memory test db has no
          // OPFS handles to release; closing it is the meaningful part.
          onClose: () => {
            connection.db?.close();
            connection.db = null;
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

      if (connection.port) {
        connection.port.postMessage(response);
      } else {
        this.dispatchEvent(
          new MessageEvent<WorkerResponse>("message", {
            data: response,
          }),
        );
      }
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
