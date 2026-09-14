import { expect, test } from "bun:test";
import { createDatabaseWorkerClient, type WorkerLike } from "../src/client";
import {
  createDatabaseRuntime,
  createSharedDatabaseRuntime,
} from "../src/runtime";
import {
  DatabaseWorkerCrashError,
  describeWorkerErrorEvent,
  workerCrashErrorFromEvent,
} from "../src/workerCrash";

class MockWorker extends EventTarget implements WorkerLike {
  readonly messages: unknown[] = [];
  closed = false;
  terminated = false;

  postMessage(message: unknown) {
    this.messages.push(message);
  }

  close() {
    this.closed = true;
  }

  terminate() {
    this.terminated = true;
  }
}

test("a worker error event is described without inventing a stack", () => {
  expect(
    describeWorkerErrorEvent(
      new ErrorEvent("error", {
        message: "Uncaught ReferenceError: sqlite3 is not defined",
        filename: "/worker.js",
        lineno: 12,
        colno: 3,
      }),
    ),
  ).toEqual({
    message: "Uncaught ReferenceError: sqlite3 is not defined",
    filename: "/worker.js",
    lineno: 12,
    colno: 3,
  });
  expect(describeWorkerErrorEvent(new Event("error"))).toEqual({
    message: "",
  });
});

test("a crash error is minted on the main thread from the event detail", () => {
  const error = workerCrashErrorFromEvent(
    new ErrorEvent("error", { message: "boom", filename: "/worker.js" }),
  );

  expect(error).toBeInstanceOf(DatabaseWorkerCrashError);
  expect(error.message).toBe("Database worker failed. boom");
  expect(error.stack).toContain("workerCrash");
  expect(workerCrashErrorFromEvent(new Event("error")).message).toBe(
    "Database worker failed.",
  );
});

test("an event that already carries an Error keeps that instance", () => {
  const carried = new DatabaseWorkerCrashError({ message: "carried" });

  expect(
    workerCrashErrorFromEvent(
      new ErrorEvent("error", { error: carried, message: carried.message }),
    ),
  ).toBe(carried);
});

test("a worker error rejects every in-flight client request instead of hanging", async () => {
  const worker = new MockWorker();
  const client = createDatabaseWorkerClient(worker);
  const pendingPing = client.ping();
  const pendingExec = client.exec({ sql: "SELECT 1", rowMode: "array" });

  worker.dispatchEvent(
    new ErrorEvent("error", { message: "worker script failed to load" }),
  );

  await expect(pendingPing).rejects.toBeInstanceOf(DatabaseWorkerCrashError);
  await expect(pendingExec).rejects.toThrow(
    "Database worker failed. worker script failed to load",
  );
});

test("the dedicated runtime surfaces a crash to its subscriber and can unsubscribe", () => {
  const worker = new MockWorker();
  const runtime = createDatabaseRuntime(worker, null);
  const observed: Error[] = [];
  const unsubscribe = runtime.subscribeWorkerError?.((error) => {
    observed.push(error);
  });

  worker.dispatchEvent(new ErrorEvent("error", { message: "first" }));
  unsubscribe?.();
  worker.dispatchEvent(new ErrorEvent("error", { message: "second" }));

  expect(observed).toHaveLength(1);
  expect(observed[0]).toBeInstanceOf(DatabaseWorkerCrashError);
  expect(observed[0]?.message).toBe("Database worker failed. first");
  runtime.terminateNow();
});

test("the shared runtime hands its subscriber the instance the coordinator dispatched", () => {
  const worker = new MockWorker();
  const runtime = createSharedDatabaseRuntime(worker);
  const observed: Error[] = [];
  runtime.subscribeWorkerError?.((error) => {
    observed.push(error);
  });
  const carried = new DatabaseWorkerCrashError({ message: "owner crashed" });
  const pendingPing = runtime.client.ping();

  worker.dispatchEvent(
    new ErrorEvent("error", { error: carried, message: carried.message }),
  );

  expect(observed).toEqual([carried]);
  expect(pendingPing).rejects.toBe(carried);
  runtime.terminateNow();
});
