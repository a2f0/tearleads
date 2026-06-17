import { expect, test } from "bun:test";
import { createDatabaseWorkerConnectionFactory } from "../src/databaseConnections";
import type { WorkerMethod, WorkerRequest, WorkerResponse } from "../src/types";
import {
  type DatabaseWorkerScope,
  registerDatabaseWorker,
} from "../src/workerCore";

class MockWorkerScope implements DatabaseWorkerScope {
  listener:
    | ((event: MessageEvent<WorkerRequest>) => void | Promise<void>)
    | undefined;
  readonly messages: WorkerResponse[] = [];

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
  registerDatabaseWorker(scope, createOptions());
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

test("delete detaches every port attached to that database", async () => {
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
      message: "Database has not been initialized.",
    },
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
