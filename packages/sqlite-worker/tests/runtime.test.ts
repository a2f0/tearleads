import { expect, test } from "bun:test";
import {
  createModuleDatabaseRuntime,
  createSharedDatabaseRuntime,
} from "../src/runtime";
import { MockMessageChannel, StatefulMockWorker } from "./runtimeTestHarness";

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
    // Reply to the graceful-shutdown requests so destroy()/deleteData() proceed
    // to terminate without waiting out their timeout. A real worker confirms
    // `close`/`delete` after releasing (or wiping) its db/OPFS handles; the mock
    // just acks immediately.
    if (message.method === "close" || message.method === "delete") {
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

class MockSharedWorkerPort extends EventTarget {
  readonly messages: WorkerMessage[] = [];
  closed = false;
  started = false;

  start() {
    this.started = true;
  }

  close() {
    this.closed = true;
  }

  postMessage(message: WorkerMessage) {
    this.messages.push(message);
    if (message.method === "close" || message.method === "delete") {
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

class MockSharedWorker extends EventTarget {
  static lastConstructed: MockSharedWorker | null = null;
  static lastScriptUrl: string | URL | null = null;
  static lastOptions:
    | {
        name?: string;
        type?: "classic" | "module";
      }
    | undefined;

  readonly port = new MockSharedWorkerPort();

  constructor(
    scriptURL: string | URL,
    options?: {
      name?: string;
      type?: "classic" | "module";
    },
  ) {
    super();
    MockSharedWorker.lastConstructed = this;
    MockSharedWorker.lastScriptUrl = scriptURL;
    MockSharedWorker.lastOptions = options;
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

test("renewClient gives a reused worker fresh port-side connection state", async () => {
  MockMessageChannel.reset();
  StatefulMockWorker.reset();
  const runtime = createModuleDatabaseRuntime({
    messageChannelConstructor: MockMessageChannel,
    workerConstructor: StatefulMockWorker,
    workerUrl: "/custom-worker.js",
  });
  const worker = StatefulMockWorker.lastConstructed;
  const oldClient = runtime.client;
  const oldRuntimeId = runtime.id;
  const oldPendingInit = oldClient.init({
    cipher: "aes256cbc",
    dbName: "database-a",
    key: "key-a",
  });

  expect(worker?.connections[0]).toMatchObject({
    initializing: true,
    dbName: null,
  });
  await expect(oldClient.close()).resolves.toEqual({ ok: true });
  expect(worker?.connections[0]).toMatchObject({
    closed: true,
    initializing: true,
  });

  expect(runtime.renewClient).toBeFunction();
  runtime.renewClient?.();

  expect(runtime.client).not.toBe(oldClient);
  expect(runtime.id).not.toBe(oldRuntimeId);
  expect(StatefulMockWorker.constructionCount).toBe(1);
  expect(worker?.terminated).toBe(false);
  expect(worker?.connections).toHaveLength(2);
  expect(
    MockMessageChannel.isStarted(MockMessageChannel.instances[0]?.port1),
  ).toBe(true);
  await expect(oldPendingInit).rejects.toThrow(
    "Database worker client has been destroyed.",
  );

  await expect(
    runtime.client.init({
      cipher: "aes256cbc",
      dbName: "database-b",
      key: "key-b",
    }),
  ).resolves.toEqual({ ok: true });
  expect(worker?.connections[1]).toMatchObject({
    dbName: "database-b",
    initializing: false,
  });
  expect(worker?.connections[0]?.requests.map(({ id }) => id)).toEqual([1, 2]);
  expect(worker?.connections[1]?.requests.map(({ id }) => id)).toEqual([3]);

  await expect(runtime.client.close()).resolves.toEqual({ ok: true });
  runtime.renewClient?.();
  await Bun.sleep(10);

  expect(
    MockMessageChannel.isClosed(MockMessageChannel.instances[0]?.port1),
  ).toBe(true);
  expect(
    MockMessageChannel.isClosed(MockMessageChannel.instances[0]?.port2),
  ).toBe(true);
  expect(worker?.connections).toHaveLength(3);
  expect(worker?.connections[1]).toMatchObject({
    closed: true,
    dbName: null,
    disconnected: true,
  });
  expect(worker?.connections[1]?.requests.map(({ id }) => id)).toEqual([3, 4]);
  expect(
    worker?.connections.filter(
      ({ disconnected, port }) => port !== null && !disconnected,
    ),
  ).toHaveLength(1);
  await expect(runtime.client.ping()).resolves.toEqual({
    message: "pong",
    ok: true,
  });
  expect(worker?.connections[2]?.requests.map(({ id }) => id)).toEqual([5]);

  const pendingAfterRenew = runtime.client.ping();
  worker?.dispatchEvent(
    new ErrorEvent("error", { message: "renewed worker crashed" }),
  );
  await expect(pendingAfterRenew).rejects.toThrow("renewed worker crashed");

  runtime.terminateNow();
  const terminatedClient = runtime.client;
  const terminatedRuntimeId = runtime.id;

  expect(
    MockMessageChannel.isClosed(MockMessageChannel.instances[1]?.port1),
  ).toBe(true);
  expect(worker?.terminated).toBe(true);

  runtime.renewClient?.();

  expect(runtime.client).toBe(terminatedClient);
  expect(runtime.id).toBe(terminatedRuntimeId);
  expect(MockMessageChannel.instances).toHaveLength(2);
  await expect(runtime.client.ping()).rejects.toThrow(
    "Database worker client has been destroyed.",
  );
});

test("renewClient preserves the old client when port transfer fails", async () => {
  MockMessageChannel.reset();
  StatefulMockWorker.reset();
  const runtime = createModuleDatabaseRuntime({
    messageChannelConstructor: MockMessageChannel,
    workerConstructor: StatefulMockWorker,
  });
  const oldClient = runtime.client;
  const oldRuntimeId = runtime.id;
  const worker = StatefulMockWorker.lastConstructed;

  if (worker) {
    worker.rejectTransfers = true;
  }

  expect(() => runtime.renewClient?.()).toThrow(
    "Failed to transfer database client port.",
  );
  expect(runtime.client).toBe(oldClient);
  expect(runtime.id).toBe(oldRuntimeId);
  expect(runtime.renewClient).toBeUndefined();
  expect(
    MockMessageChannel.isClosed(MockMessageChannel.instances[0]?.port1),
  ).toBe(true);
  expect(
    MockMessageChannel.isClosed(MockMessageChannel.instances[0]?.port2),
  ).toBe(true);
  await expect(oldClient.ping()).resolves.toEqual({
    message: "pong",
    ok: true,
  });
  runtime.terminateNow();
});

test("dedicated runtime omits renewal without MessageChannel support", () => {
  const runtime = createModuleDatabaseRuntime({
    messageChannelConstructor: null,
    workerConstructor: MockWorker,
  });

  expect(runtime.renewClient).toBeUndefined();
  runtime.terminateNow();
});

test("createModuleDatabaseRuntime creates a shared module worker when supplied", async () => {
  const runtime = createModuleDatabaseRuntime({
    sharedWorkerConstructor: MockSharedWorker,
    workerUrl: "/custom-worker.js",
  });

  const pendingPing = runtime.client.ping();
  const port = MockSharedWorker.lastConstructed?.port;

  expect(MockSharedWorker.lastScriptUrl).toBe("/custom-worker.js");
  expect(MockSharedWorker.lastOptions).toEqual({
    name: "symcrypt-sqlite-worker",
    type: "module",
  });
  expect(port?.started).toBe(true);
  expect(port?.messages).toEqual([
    {
      id: 1,
      method: "ping",
      params: undefined,
    },
  ]);

  runtime.destroy();

  expect(port?.messages.at(-1)).toEqual({
    id: 2,
    method: "close",
    params: undefined,
  });
  expect(port?.closed).toBe(false);

  await expect(pendingPing).rejects.toThrow(
    "Database worker client has been destroyed.",
  );
  expect(port?.closed).toBe(true);
});

test("deleteData posts a delete request, then terminates the worker", async () => {
  const runtime = createModuleDatabaseRuntime({
    workerConstructor: MockWorker,
    workerUrl: "/custom-worker.js",
  });
  const pendingPing = runtime.client.ping();
  const worker = MockWorker.lastConstructed;

  // deleteData() asks the worker to WIPE its OPFS files (vs destroy()'s close)
  // and resolves once the worker confirms; the worker is then terminated.
  await runtime.deleteData();

  expect(worker?.messages.at(-1)).toEqual({
    id: 2,
    method: "delete",
    params: undefined,
  });
  expect(worker?.terminated).toBe(true);
  await expect(pendingPing).rejects.toThrow(
    "Database worker client has been destroyed.",
  );
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

// A cross-tab worker handle: like createCrossTabDatabaseWorker's return, it exposes
// forceStopOwner() alongside close(). `ackClose` controls whether it answers a
// close request — with `false` it models a wedged/silent worker whose graceful
// close never comes back.
class MockCrossTabWorker extends EventTarget {
  closed = false;
  forceStopped = false;
  readonly messages: WorkerMessage[] = [];

  constructor(
    private readonly ackClose: (message: WorkerMessage) => boolean | undefined,
  ) {
    super();
  }

  postMessage(message: WorkerMessage) {
    this.messages.push(message);
    if (message.method !== "close" && message.method !== "delete") {
      return;
    }
    const ack = this.ackClose(message);
    if (ack === undefined) {
      return; // silent: never answers, so the graceful close never resolves
    }
    queueMicrotask(() => {
      this.dispatchEvent(
        new MessageEvent("message", {
          data: {
            id: message.id,
            result: ack ? { ok: true } : { ok: false, message: "close failed" },
          },
        }),
      );
    });
  }

  close() {
    this.closed = true;
  }

  forceStopOwner() {
    this.forceStopped = true;
  }
}

test("shared runtime terminateNow force-stops a possibly-wedged owner", async () => {
  // terminateNow() is the app's recovery/teardown entry point (releaseSQLiteRuntime).
  // It must force-stop the owner so a wedged (silent) worker cannot stay pinned to
  // the singleton coordinator and hang every later boot.
  const worker = new MockCrossTabWorker(() => undefined); // silent
  const runtime = createSharedDatabaseRuntime(worker);

  runtime.terminateNow();

  expect(worker.forceStopped).toBe(true);
  expect(worker.closed).toBe(true);
});

test("shared runtime destroy force-stops the owner when the close is rejected", async () => {
  // A close that comes back as an error (or never comes back) means the owner may
  // be wedged, so destroy() takes the forceClose path.
  const worker = new MockCrossTabWorker(() => false); // acks close with an error
  const runtime = createSharedDatabaseRuntime(worker);

  runtime.destroy();
  await new Promise((resolve) => setTimeout(resolve, 0));

  expect(worker.forceStopped).toBe(true);
  expect(worker.closed).toBe(true);
});

test("shared runtime destroy does NOT force-stop the owner on a healthy close", async () => {
  // When the worker acks the graceful close it has already stopped the owner
  // itself, so destroy() uses a plain close() and must not force-stop — otherwise
  // it would tear down an owner that another client (or tab) may still be using.
  const worker = new MockCrossTabWorker(() => true); // acks close successfully
  const runtime = createSharedDatabaseRuntime(worker);

  runtime.destroy();
  await new Promise((resolve) => setTimeout(resolve, 0));

  expect(worker.closed).toBe(true);
  expect(worker.forceStopped).toBe(false);
});

test("shared runtime deleteData force-stops the owner when the delete is rejected", async () => {
  // deleteData (forget-local-data) also takes the forceClose path when its wipe
  // request comes back as an error, so a wedged owner cannot survive the teardown.
  const worker = new MockCrossTabWorker(() => false); // acks delete with an error
  const runtime = createSharedDatabaseRuntime(worker);

  await runtime.deleteData();

  expect(worker.forceStopped).toBe(true);
  expect(worker.closed).toBe(true);
});
