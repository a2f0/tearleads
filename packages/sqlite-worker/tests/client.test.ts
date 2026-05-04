import { expect, test } from "bun:test";
import { createDatabaseWorkerClient, type WorkerLike } from "../src/client";

type WorkerMessage = {
  id: number;
  method: string;
  params: unknown;
};

class MockWorker extends EventTarget implements WorkerLike {
  readonly messages: WorkerMessage[] = [];

  postMessage(message: WorkerMessage) {
    this.messages.push(message);
  }
}

test("destroy rejects pending requests and detaches listeners", async () => {
  const worker = new MockWorker();
  const client = createDatabaseWorkerClient(worker);

  const pendingPing = client.ping();
  expect(worker.messages).toHaveLength(1);

  client.destroy();

  expect(pendingPing).rejects.toThrow(
    "Database worker client has been destroyed.",
  );

  worker.dispatchEvent(
    new MessageEvent("message", {
      data: {
        id: worker.messages[0]?.id ?? 1,
        result: {
          ok: true,
          message: "pong",
        },
      },
    }),
  );

  expect(client.ping()).rejects.toThrow(
    "Database worker client has been destroyed.",
  );
});

test("exec posts query requests", async () => {
  const worker = new MockWorker();
  const client = createDatabaseWorkerClient(worker);

  void client.exec({
    sql: "SELECT 1 AS value",
    bind: [1],
    rowMode: "array",
  });

  expect(worker.messages).toEqual([
    {
      id: 1,
      method: "exec",
      params: {
        sql: "SELECT 1 AS value",
        bind: [1],
        rowMode: "array",
      },
    },
  ]);
});
