import { expect, test } from "bun:test";
import { createModuleDatabaseRuntime } from "../src/runtime";

type WorkerMessage = {
  id: number;
  method: string;
  params: unknown;
};

class MockWorker extends EventTarget {
  static lastConstructed: MockWorker | null = null;
  static lastScriptUrl: string | URL | null = null;
  static lastOptions: WorkerOptions | undefined;

  readonly messages: WorkerMessage[] = [];
  terminated = false;

  constructor(scriptURL: string | URL, options?: WorkerOptions) {
    super();
    MockWorker.lastConstructed = this;
    MockWorker.lastScriptUrl = scriptURL;
    MockWorker.lastOptions = options;
  }

  terminate() {
    this.terminated = true;
  }

  postMessage(message: WorkerMessage) {
    this.messages.push(message);
  }
}

test("createModuleDatabaseRuntime creates a module worker and destroys it", async () => {
  const runtime = createModuleDatabaseRuntime({
    workerConstructor: MockWorker,
    workerUrl: "/custom-worker.js",
  });

  const pendingPing = runtime.client.ping();
  const worker = MockWorker.lastConstructed;

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
  expect(pendingPing).rejects.toThrow(
    "Database worker client has been destroyed.",
  );
});
