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

test("shared request sequence stays unique across client generations", async () => {
  const worker = new MockWorker();
  const requestIdSequence = { current: 7 };
  const oldClient = createDatabaseWorkerClient(worker, requestIdSequence);

  const oldPendingPing = oldClient.ping();
  oldClient.destroy();

  await expect(oldPendingPing).rejects.toThrow(
    "Database worker client has been destroyed.",
  );

  const newClient = createDatabaseWorkerClient(worker, requestIdSequence);
  const newPendingPing = newClient.ping();

  expect(worker.messages.map(({ id }) => id)).toEqual([7, 8]);

  worker.dispatchEvent(
    new MessageEvent("message", {
      data: {
        id: 7,
        result: { ok: true, message: "pong" },
      },
    }),
  );
  worker.dispatchEvent(
    new MessageEvent("message", {
      data: {
        id: 8,
        result: { ok: true, message: "pong" },
      },
    }),
  );

  await expect(newPendingPing).resolves.toEqual({
    ok: true,
    message: "pong",
  });
  newClient.destroy();
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

test("a logout that loses ownership while the worker drains closes and retains the database", async () => {
  const worker = new MockWorker();
  const client = createDatabaseWorkerClient(worker);
  const reply = (id: number) =>
    worker.dispatchEvent(
      new MessageEvent("message", {
        data: { id, result: { ok: true } },
      }),
    );
  try {
    let current = true;
    const pending = client.delete(() => current);
    expect(worker.messages[0]?.method).toBe("prepareDelete");
    current = false;
    reply(1);
    await Promise.resolve();
    expect(worker.messages[1]?.method).toBe("close");
    reply(2);
    await expect(pending).resolves.toEqual({ ok: true });
  } finally {
    client.destroy();
  }
});
