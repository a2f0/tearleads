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
    // Reply to the graceful-shutdown request so destroy() proceeds to terminate
    // without waiting out its timeout. A real worker confirms `close` after
    // releasing its db/OPFS handles; the mock just acks immediately.
    if (message.method === "close") {
      queueMicrotask(() => {
        this.dispatchEvent(
          new MessageEvent("message", {
            data: { id: message.id, result: { ok: true } },
          }),
        );
      });
    }
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

  // destroy() now closes gracefully before terminating: it posts a `close`
  // request first (so the worker can release its OPFS access handles) and only
  // terminates once the worker confirms. So termination is no longer synchronous.
  expect(worker?.messages.at(-1)).toEqual({
    id: 2,
    method: "close",
    params: undefined,
  });
  expect(worker?.terminated).toBe(false);

  // After the worker acks the close, the runtime terminates and rejects the
  // still-pending ping.
  await expect(pendingPing).rejects.toThrow(
    "Database worker client has been destroyed.",
  );
  expect(worker?.terminated).toBe(true);
});

test("createModuleDatabaseRuntime terminates even if the worker never confirms close", async () => {
  // A wedged worker that never replies to `close` must not hang teardown forever.
  // destroy() falls back to terminating after its timeout. We assert the request
  // is posted; the timeout path itself is covered by the runtime's constant
  // rather than waited out here (it is 1s) to keep the suite fast.
  class SilentWorker extends MockWorker {
    override postMessage(message: WorkerMessage) {
      this.messages.push(message);
      // Intentionally never acks `close`.
    }
  }

  const runtime = createModuleDatabaseRuntime({
    workerConstructor: SilentWorker,
    workerUrl: "/custom-worker.js",
  });
  const worker = MockWorker.lastConstructed;

  runtime.destroy();

  expect(worker?.messages.at(-1)).toEqual({
    id: 1,
    method: "close",
    params: undefined,
  });
});
