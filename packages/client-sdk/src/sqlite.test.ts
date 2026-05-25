import { expect, test } from "bun:test";
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import {
  createModuleSQLiteRuntime,
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

test("SQLite facade exposes the module worker runtime factory", async () => {
  const runtime = createModuleSQLiteRuntime({
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
