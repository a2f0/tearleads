import { expect, test } from "bun:test";
import {
  handleRequest,
  registerDatabaseWorker,
  type DatabaseWorkerScope,
} from "../src/workerCore";
import type { WorkerRequest, WorkerResponse } from "../src/types";

class MockWorkerScope implements DatabaseWorkerScope {
  listener: ((event: MessageEvent<WorkerRequest>) => void | Promise<void>) | undefined;
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
        onInit() {
          throw new Error("init failed");
        },
      },
    ),
  ).rejects.toThrow("init failed");
});

test("registerDatabaseWorker posts error responses for thrown init handlers", async () => {
  const scope = new MockWorkerScope();

  registerDatabaseWorker(scope, {
    onInit() {
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
