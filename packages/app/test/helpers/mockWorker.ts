import {
  execDatabaseStatement,
  loadSqlite3,
} from "@tearleads/sqlite-worker/load-sqlite3";
import type {
  DatabaseWorkerInitOptions,
  WorkerRequest,
  WorkerResponse,
} from "@tearleads/sqlite-worker/types";
import {
  WORKER_CONNECT_PORT_MESSAGE_TYPE,
  WORKER_DISCONNECT_PORT_MESSAGE_TYPE,
  WORKER_PORT_DISCONNECTED_MESSAGE_TYPE,
} from "@tearleads/sqlite-worker/types";
import {
  handleRequest,
  isWorkerRequest,
} from "@tearleads/sqlite-worker/worker-core";

type TestDatabase = InstanceType<
  Awaited<ReturnType<typeof loadSqlite3>>["oo1"]["DB"]
>;
type TestSqlite3 = Awaited<ReturnType<typeof loadSqlite3>>;

interface MockWorkerConnection {
  dbName: string | null;
  disconnecting: boolean;
  generation: number;
  initializing: boolean;
  readonly port: MessagePort | null;
  removePortListener?: (() => void) | undefined;
}

interface MockDatabaseEntry {
  readonly db: TestDatabase;
  readonly optionsKey: string;
  refCount: number;
}

interface MockDatabaseOpening {
  readonly optionsKey: string;
  readonly promise: Promise<MockDatabaseEntry>;
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
      // Closing the sending endpoint does not retract an already-posted
      // message. This matters for the worker's disconnect-ack-then-close path.
      if (!peer.closed) {
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

async function initTestDatabase(path: string): Promise<TestDatabase> {
  const sqlite3 = await loadSqlite3ForTest();

  // A named wasm-VFS file survives close/reopen for this MockWorker. That keeps
  // renewed logical connections faithful to production: connections for one
  // dbName share a registry entry, and reopening that dbName preserves data.
  return new sqlite3.oo1.DB(path);
}

function isConnectPortMessage(value: unknown): boolean {
  return (
    typeof value === "object" &&
    value !== null &&
    Reflect.get(value, "type") === WORKER_CONNECT_PORT_MESSAGE_TYPE
  );
}

function isDisconnectPortMessage(value: unknown): boolean {
  return (
    typeof value === "object" &&
    value !== null &&
    Reflect.get(value, "type") === WORKER_DISCONNECT_PORT_MESSAGE_TYPE
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

function initOptionsKey(options: DatabaseWorkerInitOptions): string {
  return [
    options.dbName,
    options.persistence ?? "memory",
    options.cipher,
    options.key,
  ].join("\0");
}

// Minimal worker test double for App.tsx. It uses the shared sqlite worker
// protocol so test behavior stays aligned with the real worker contract.
export class MockWorker extends EventTarget {
  private readonly directConnection: MockWorkerConnection = {
    dbName: null,
    disconnecting: false,
    generation: 0,
    initializing: false,
    port: null,
  };
  private readonly connections = new Set<MockWorkerConnection>([
    this.directConnection,
  ]);
  private readonly databaseEntries = new Map<string, MockDatabaseEntry>();
  private readonly databaseOpenings = new Map<string, MockDatabaseOpening>();
  private readonly databasePaths = new Map<string, string>();
  terminated = false;

  constructor(_scriptURL?: string | URL, _options?: WorkerOptions) {
    super();
  }

  terminate() {
    for (const entry of this.databaseEntries.values()) {
      entry.db.close();
    }
    this.databaseEntries.clear();
    for (const connection of this.connections) {
      connection.generation += 1;
      connection.dbName = null;
      connection.removePortListener?.();
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

      const connection: MockWorkerConnection = {
        dbName: null,
        disconnecting: false,
        generation: 0,
        initializing: false,
        port,
      };
      this.connections.add(connection);
      const handlePortMessage = (event: MessageEvent<unknown>) => {
        this.handleMessage(connection, Reflect.get(event, "data"));
      };
      connection.removePortListener = () => {
        port.removeEventListener("message", handlePortMessage);
        connection.removePortListener = undefined;
      };
      port.addEventListener("message", handlePortMessage);
      port.start();
      return;
    }

    this.handleMessage(this.directConnection, message);
  }

  protected onRequest(_message: WorkerRequest) {}

  private handleMessage(connection: MockWorkerConnection, message: unknown) {
    if (connection.disconnecting) {
      return;
    }

    if (isDisconnectPortMessage(message)) {
      connection.disconnecting = true;
      connection.removePortListener?.();
      const released = this.releaseConnection(connection);
      queueMicrotask(async () => {
        await released;
        connection.port?.postMessage({
          type: WORKER_PORT_DISCONNECTED_MESSAGE_TYPE,
        });
        connection.port?.close();
        this.connections.delete(connection);
      });
      return;
    }

    if (!isWorkerRequest(message)) {
      return;
    }
    this.onRequest(message);

    queueMicrotask(async () => {
      let response: WorkerResponse;
      try {
        response = await handleRequest(message, {
          onInit: async (options) => {
            if (connection.dbName || connection.initializing) {
              throw new Error("Database has already been initialized.");
            }

            const generation = connection.generation;
            connection.initializing = true;
            try {
              const entry = await this.acquireDatabase(options);
              if (
                connection.generation !== generation ||
                connection.disconnecting ||
                connection.dbName
              ) {
                this.releaseDatabase(options.dbName, entry);
                throw new Error(
                  "Database connection closed before initialization completed.",
                );
              }
              connection.dbName = options.dbName;
            } finally {
              connection.initializing = false;
            }
          },
          onExec: async (options) => {
            const entry = connection.dbName
              ? this.databaseEntries.get(connection.dbName)
              : null;
            if (!entry) {
              throw new Error("Database has not been initialized.");
            }

            return execDatabaseStatement(entry.db, options);
          },
          // Mirror the real worker's graceful close so the runtime's close→terminate
          // teardown path is exercised in app tests too. The in-memory test db has no
          // OPFS handles to release; closing it is the meaningful part.
          onClose: () => this.releaseConnection(connection),
          onDelete: () => this.deleteConnection(connection),
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

  private async acquireDatabase(
    options: DatabaseWorkerInitOptions,
  ): Promise<MockDatabaseEntry> {
    const { dbName } = options;
    const optionsKey = initOptionsKey(options);
    const existing = this.databaseEntries.get(dbName);
    if (existing) {
      if (existing.optionsKey !== optionsKey) {
        throw new Error(
          "Database is already initialized with different options.",
        );
      }
      existing.refCount += 1;
      return existing;
    }

    const pending = this.databaseOpenings.get(dbName);
    if (pending) {
      if (pending.optionsKey !== optionsKey) {
        throw new Error(
          "Database is already initializing with different options.",
        );
      }
      const entry = await pending.promise;
      entry.refCount += 1;
      return entry;
    }

    const path =
      this.databasePaths.get(dbName) ?? `/mock-${crypto.randomUUID()}.sqlite3`;
    this.databasePaths.set(dbName, path);
    const opening = initTestDatabase(path).then((db) => {
      const created = { db, optionsKey, refCount: 0 };
      this.databaseEntries.set(dbName, created);
      return created;
    });
    const pendingOpening = { optionsKey, promise: opening };
    this.databaseOpenings.set(dbName, pendingOpening);
    try {
      const entry = await opening;
      entry.refCount += 1;
      return entry;
    } finally {
      if (this.databaseOpenings.get(dbName) === pendingOpening) {
        this.databaseOpenings.delete(dbName);
      }
    }
  }

  private async releaseConnection(
    connection: MockWorkerConnection,
  ): Promise<void> {
    connection.generation += 1;
    const dbName = connection.dbName;
    connection.dbName = null;
    if (!dbName) {
      return;
    }

    const entry = this.databaseEntries.get(dbName);
    if (!entry) {
      return;
    }

    this.releaseDatabase(dbName, entry);
  }

  private releaseDatabase(dbName: string, entry: MockDatabaseEntry): void {
    entry.refCount = Math.max(0, entry.refCount - 1);
    if (entry.refCount > 0) {
      return;
    }

    entry.db.close();
    if (this.databaseEntries.get(dbName) === entry) {
      this.databaseEntries.delete(dbName);
    }
  }

  private async deleteConnection(
    connection: MockWorkerConnection,
  ): Promise<void> {
    connection.generation += 1;
    const dbName = connection.dbName;
    if (!dbName) {
      return;
    }

    for (const openConnection of this.connections) {
      if (openConnection.dbName === dbName) {
        openConnection.generation += 1;
        openConnection.dbName = null;
      }
    }
    this.databaseEntries.get(dbName)?.db.close();
    this.databaseEntries.delete(dbName);
    // A subsequent init gets a new backing file, which models a destructive
    // delete without relying on untyped VFS-unlink APIs in this test helper.
    this.databasePaths.delete(dbName);
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
