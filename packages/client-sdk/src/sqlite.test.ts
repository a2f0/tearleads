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
    this.messages.push(message as WorkerMessage);
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

  expect(worker?.terminated).toBe(true);
  await expect(pendingPing).rejects.toThrow(
    "Database worker client has been destroyed.",
  );
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

  expect(worker.terminated).toBe(true);
  await expect(pendingPing).rejects.toThrow(
    "Database worker client has been destroyed.",
  );

  const compatibilityWorker = new MockWorker("/compat-worker.js");
  const compatibilityRuntime = createSQLiteRuntime(compatibilityWorker);
  const pendingCompatibilityPing = compatibilityRuntime.client.ping();

  compatibilityRuntime.destroy();

  expect(compatibilityWorker.terminated).toBe(true);
  await expect(pendingCompatibilityPing).rejects.toThrow(
    "Database worker client has been destroyed.",
  );
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
