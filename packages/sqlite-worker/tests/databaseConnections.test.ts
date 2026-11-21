import { expect, test } from "bun:test";
import { createDatabaseWorkerConnectionFactory } from "../src/databaseConnections";
import type { WorkerMethod, WorkerRequest, WorkerResponse } from "../src/types";
import {
  type DatabaseWorkerScope,
  registerDatabaseWorker,
} from "../src/workerCore";
import {
  installOpfsMemoryShim,
  uninstallOpfsMemoryShim,
} from "./opfsMemoryShim";

class MockWorkerScope implements DatabaseWorkerScope {
  listener:
    | ((event: MessageEvent<WorkerRequest>) => void | Promise<void>)
    | undefined;
  readonly messages: WorkerResponse[] = [];
  readonly notices: unknown[] = [];

  addEventListener(
    type: "message",
    listener: (event: MessageEvent<WorkerRequest>) => void | Promise<void>,
  ): void {
    if (type === "message") {
      this.listener = listener;
    }
  }

  postMessage(message: WorkerResponse): void {
    this.messages.push(message);
  }

  async dispatch(message: WorkerRequest): Promise<WorkerResponse> {
    const messageCount = this.messages.length;
    await this.listener?.(new MessageEvent("message", { data: message }));
    const response = this.messages[messageCount];
    if (!response) {
      throw new Error("Worker did not post a response.");
    }

    return response;
  }
}

function connectSharedWorkerPort(
  createOptions: ReturnType<typeof createDatabaseWorkerConnectionFactory>,
): MockWorkerScope {
  const scope = new MockWorkerScope();
  registerDatabaseWorker(
    scope,
    createOptions((notice) => scope.notices.push(notice)),
  );
  return scope;
}

function request<K extends WorkerMethod>(
  id: number,
  method: K,
  params: WorkerRequest<K>["params"],
): WorkerRequest<K> {
  return { id, method, params } as WorkerRequest<K>;
}

function initOptions(dbName: string, key = "secret") {
  return {
    cipher: "sqlcipher" as const,
    dbName,
    key,
  };
}

test("ports attached to the same database share one open connection", async () => {
  const createOptions = createDatabaseWorkerConnectionFactory();
  const first = connectSharedWorkerPort(createOptions);
  const second = connectSharedWorkerPort(createOptions);
  const dbName = `shared-${crypto.randomUUID()}.db`;

  expect(await first.dispatch(request(1, "init", initOptions(dbName)))).toEqual(
    {
      id: 1,
      result: { ok: true },
    },
  );
  expect(
    await first.dispatch(
      request(2, "exec", {
        rowMode: "array",
        sql: "CREATE TABLE shared_items (value INTEGER)",
      }),
    ),
  ).toEqual({
    id: 2,
    result: { ok: true, rows: [] },
  });
  await first.dispatch(
    request(3, "exec", {
      rowMode: "array",
      sql: "INSERT INTO shared_items (value) VALUES (42)",
    }),
  );

  expect(
    await second.dispatch(request(4, "init", initOptions(dbName))),
  ).toEqual({
    id: 4,
    result: { ok: true },
  });
  expect(
    await second.dispatch(
      request(5, "exec", {
        rowMode: "array",
        sql: "SELECT value FROM shared_items",
      }),
    ),
  ).toEqual({
    id: 5,
    result: { ok: true, rows: [[42]] },
  });
});

test("closing one port keeps the shared database open for another port", async () => {
  const createOptions = createDatabaseWorkerConnectionFactory();
  const first = connectSharedWorkerPort(createOptions);
  const second = connectSharedWorkerPort(createOptions);
  const dbName = `shared-close-${crypto.randomUUID()}.db`;

  await first.dispatch(request(1, "init", initOptions(dbName)));
  await first.dispatch(
    request(2, "exec", {
      rowMode: "array",
      sql: "CREATE TABLE shared_items (value INTEGER)",
    }),
  );
  await first.dispatch(
    request(3, "exec", {
      rowMode: "array",
      sql: "INSERT INTO shared_items (value) VALUES (7)",
    }),
  );
  await second.dispatch(request(4, "init", initOptions(dbName)));

  expect(await first.dispatch(request(5, "close", undefined))).toEqual({
    id: 5,
    result: { ok: true },
  });
  expect(
    await second.dispatch(
      request(6, "exec", {
        rowMode: "array",
        sql: "SELECT value FROM shared_items",
      }),
    ),
  ).toEqual({
    id: 6,
    result: { ok: true, rows: [[7]] },
  });
});

test("delete detaches every port attached to that database and says so", async () => {
  const createOptions = createDatabaseWorkerConnectionFactory();
  const first = connectSharedWorkerPort(createOptions);
  const second = connectSharedWorkerPort(createOptions);
  const dbName = `shared-delete-${crypto.randomUUID()}.db`;

  await first.dispatch(request(1, "init", initOptions(dbName)));
  await second.dispatch(request(2, "init", initOptions(dbName)));

  expect(await first.dispatch(request(3, "delete", undefined))).toEqual({
    id: 3,
    result: { ok: true },
  });
  // The other port hears of the delete at once; the deleting port does not.
  expect(second.notices).toEqual([
    { type: "tearleads:sqlite-database-deleted" },
  ]);
  expect(first.notices).toEqual([]);
  expect(
    await first.dispatch(
      request(9, "exec", { rowMode: "array", sql: "SELECT 1" }),
    ),
  ).toEqual({
    id: 9,
    result: { ok: false, message: "Database has not been initialized." },
  });
  expect(
    await second.dispatch(
      request(4, "exec", {
        rowMode: "array",
        sql: "SELECT 1",
      }),
    ),
  ).toEqual({
    id: 4,
    result: {
      ok: false,
      message: "Database was deleted by another connection.",
    },
  });

  // A port that opens a database again is an ordinary open connection.
  await second.dispatch(request(5, "init", initOptions(dbName)));
  expect(
    await second.dispatch(
      request(6, "exec", { rowMode: "array", sql: "SELECT 1" }),
    ),
  ).toEqual({ id: 6, result: { ok: true, rows: [[1]] } });
  await second.dispatch(request(7, "close", undefined));
  expect(
    await second.dispatch(
      request(8, "exec", { rowMode: "array", sql: "SELECT 1" }),
    ),
  ).toEqual({
    id: 8,
    result: { ok: false, message: "Database has not been initialized." },
  });
});

test("same database with different init options is rejected", async () => {
  const createOptions = createDatabaseWorkerConnectionFactory();
  const first = connectSharedWorkerPort(createOptions);
  const second = connectSharedWorkerPort(createOptions);
  const dbName = `shared-key-${crypto.randomUUID()}.db`;

  await first.dispatch(request(1, "init", initOptions(dbName, "secret-a")));

  expect(
    await second.dispatch(request(2, "init", initOptions(dbName, "secret-b"))),
  ).toEqual({
    id: 2,
    result: {
      ok: false,
      message: "Database is already initialized with different options.",
    },
  });
});

test("a worker that has opened persistent storage refuses to wipe it", async () => {
  installOpfsMemoryShim();
  const scope = connectSharedWorkerPort(
    createDatabaseWorkerConnectionFactory(),
  );
  const dbName = `/wipe-${crypto.randomUUID()}.db`;

  try {
    expect(
      await scope.dispatch(
        request(1, "init", {
          cipher: "chacha20",
          dbName,
          key: "secret",
          persistence: "opfs-sahpool",
        }),
      ),
    ).toEqual({ id: 1, result: { ok: true } });

    expect(await scope.dispatch(request(2, "wipeStorage", undefined))).toEqual({
      id: 2,
      result: {
        ok: false,
        message:
          "Storage can only be wiped before this worker opens a database.",
      },
    });
  } finally {
    await scope.dispatch(request(3, "delete", undefined));
    uninstallOpfsMemoryShim();
  }
});

test("a database opens only after every overlapping storage wipe finishes", async () => {
  const previousNavigator = Object.getOwnPropertyDescriptor(
    globalThis,
    "navigator",
  );
  const firstRemoval = Promise.withResolvers<void>();
  let removals = 0;
  // Only the first wipe is slow; a second one finds nothing left to wait on.
  const root = {
    async *entries() {
      yield ["tearleads-sqlite", {}] as const;
    },
    async removeEntry() {
      removals += 1;
      if (removals === 1) {
        await firstRemoval.promise;
      }
    },
  };
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: { storage: { getDirectory: async () => root } },
    writable: true,
  });
  const scope = connectSharedWorkerPort(
    createDatabaseWorkerConnectionFactory(),
  );
  const send = (message: WorkerRequest) =>
    scope.listener?.(new MessageEvent("message", { data: message }));

  try {
    const settled = [
      send(request(1, "wipeStorage", undefined)),
      send(request(2, "wipeStorage", undefined)),
      send(request(3, "init", initOptions(`wiped-${crypto.randomUUID()}.db`))),
    ];
    // Give an unserialized open time to finish while the first wipe runs. A
    // real delay: opening is SQLite work, and a correct registry never signals
    // it before the wipe is released, so there is no event to await instead.
    await Promise.race([
      settled[2],
      new Promise((resolve) => setTimeout(resolve, 200)),
    ]);
    firstRemoval.resolve();
    await Promise.all(settled);

    expect(scope.messages).toEqual([
      { id: 1, result: { ok: true } },
      { id: 2, result: { ok: true } },
      { id: 3, result: { ok: true } },
    ]);
  } finally {
    firstRemoval.resolve();
    await scope.dispatch(request(4, "delete", undefined));
    if (previousNavigator) {
      Object.defineProperty(globalThis, "navigator", previousNavigator);
    } else {
      Reflect.deleteProperty(globalThis, "navigator");
    }
  }
});
