import { expect, test } from "bun:test";
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import {
  createSQLiteRuntime,
  createSQLiteRuntimeFromWorker,
  defineSqlTableSchema,
  type ExecSql,
  getSQLitePersistenceRuntime,
} from "./sqlite";

type WorkerMessage = {
  id: number;
  method: string;
  params: unknown;
};

class MockWorker extends EventTarget {
  static lastConstructed: MockWorker | null = null;
  static lastOptions: WorkerOptions | undefined;
  static lastScriptUrl: string | URL | null = null;

  readonly messages: WorkerMessage[] = [];
  terminated = false;

  constructor(scriptURL: string | URL, options?: WorkerOptions) {
    super();
    MockWorker.lastConstructed = this;
    MockWorker.lastScriptUrl = scriptURL;
    MockWorker.lastOptions = options;
  }

  postMessage(message: unknown) {
    const workerMessage = message as WorkerMessage;
    this.messages.push(workerMessage);
    // Ack the graceful-shutdown request so destroy() proceeds to terminate
    // immediately instead of waiting out its fallback timeout. The runtime now
    // closes the worker (releasing its OPFS handles) before terminating it.
    if (workerMessage.method === "close") {
      queueMicrotask(() => {
        this.dispatchEvent(
          new MessageEvent("message", {
            data: { id: workerMessage.id, result: { ok: true } },
          }),
        );
      });
    }
  }

  terminate() {
    this.terminated = true;
  }
}

test("SQLite facade exposes the default module worker runtime factory", async () => {
  const runtime = createSQLiteRuntime({
    workerConstructor: MockWorker,
    workerUrl: "/custom-worker.js",
  });
  const worker = MockWorker.lastConstructed;

  const pendingPing = runtime.client.ping();

  expect(MockWorker.lastScriptUrl).toBe("/custom-worker.js");
  expect(MockWorker.lastOptions).toEqual({ type: "module" });
  expect(worker?.messages).toEqual([
    {
      id: 1,
      method: "ping",
      params: undefined,
    },
  ]);

  runtime.destroy();

  // destroy() gracefully closes before terminating, so termination is no longer
  // synchronous; it completes after the worker acks the close, at which point the
  // pending ping is rejected.
  await expect(pendingPing).rejects.toThrow(
    "Database worker client has been destroyed.",
  );
  expect(worker?.terminated).toBe(true);
});

test("SQLite facade wraps a host-created worker explicitly", async () => {
  const worker = new MockWorker("/host-worker.js");
  const runtime = createSQLiteRuntimeFromWorker(worker);
  const pendingPing = runtime.client.ping();

  expect(worker.messages).toEqual([
    {
      id: 1,
      method: "ping",
      params: undefined,
    },
  ]);

  runtime.destroy();

  await expect(pendingPing).rejects.toThrow(
    "Database worker client has been destroyed.",
  );
  expect(worker.terminated).toBe(true);
});

test("SQLite facade exposes typed persistence DSL helpers", () => {
  const exampleProjection = sqliteTable("example_projection", {
    count: integer("count").notNull().default(0),
    id: text("id").primaryKey(),
  });
  const execSql: ExecSql = async () => [];

  expect(defineSqlTableSchema(exampleProjection)).toMatchObject({
    name: "example_projection",
  });
  expect(getSQLitePersistenceRuntime(execSql).execSql).toBe(execSql);
});
