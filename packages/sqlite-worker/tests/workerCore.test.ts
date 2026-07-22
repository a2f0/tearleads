import { expect, test } from "bun:test";
import type { WorkerRequest, WorkerResponse } from "../src/types";
import {
  type DatabaseWorkerScope,
  handleRequest,
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

  removeEventListener(
    type: "message",
    listener: (event: MessageEvent<WorkerRequest>) => void | Promise<void>,
  ): void {
    if (type === "message" && this.listener === listener) {
      this.listener = undefined;
    }
  }

  postMessage(message: WorkerResponse): void {
    this.messages.push(message);
  }

  async dispatch(message: WorkerRequest): Promise<void> {
    await this.listener?.(new MessageEvent("message", { data: message }));
  }
}

test("handleRequest returns init error responses", async () => {
  expect(
    handleRequest(
      {
        id: 1,
        method: "init",
        params: {
          dbName: "test.db",
          cipher: "sqlcipher",
          key: "secret",
        },
      },
      {
        onInit(_options) {
          throw new Error("init failed");
        },
      },
    ),
  ).rejects.toThrow("init failed");
});

test("registerDatabaseWorker posts error responses for thrown init handlers", async () => {
  const scope = new MockWorkerScope();

  registerDatabaseWorker(scope, {
    onInit(_options) {
      throw new Error("init failed");
    },
  });

  await scope.dispatch({
    id: 2,
    method: "init",
    params: {
      dbName: "test.db",
      cipher: "sqlcipher",
      key: "secret",
    },
  });

  expect(scope.messages).toEqual([
    {
      id: 2,
      result: {
        ok: false,
        message: "init failed",
      },
    },
  ]);
});

test("registerDatabaseWorker unregisters its request listener", async () => {
  const scope = new MockWorkerScope();
  const unregister = registerDatabaseWorker(scope);

  unregister();
  await scope.dispatch({ id: 20, method: "ping", params: undefined });

  expect(scope.messages).toEqual([]);
});

test("handleRequest returns exec rows", async () => {
  await expect(
    handleRequest(
      {
        id: 3,
        method: "exec",
        params: {
          sql: "SELECT 1 AS value",
          bind: [1],
          rowMode: "array",
        },
      },
      {
        onExec(options) {
          expect(options).toEqual({
            sql: "SELECT 1 AS value",
            bind: [1],
            rowMode: "array",
          });
          return [[1]];
        },
      },
    ),
  ).resolves.toEqual({
    id: 3,
    result: {
      ok: true,
      rows: [[1]],
    },
  });
});
