import { expect, test } from "bun:test";
import {
  WORKER_CONNECT_PORT_MESSAGE_TYPE,
  WORKER_DISCONNECT_PORT_MESSAGE_TYPE,
  WORKER_PORT_DISCONNECTED_MESSAGE_TYPE,
} from "../src/types";

// Wait for exactly one worker response so each assertion can pair a request
// with its next message without leaving persistent listeners behind.
function onceMessage(worker: Worker): Promise<unknown> {
  return new Promise((resolve, reject) => {
    worker.addEventListener("message", (event) => resolve(event.data), {
      once: true,
    });
    worker.addEventListener("error", reject, { once: true });
  });
}

function oncePortMessage(port: MessagePort): Promise<unknown> {
  return new Promise((resolve) => {
    port.addEventListener("message", (event) => resolve(event.data), {
      once: true,
    });
    port.start();
  });
}

test("worker responds to ping", async () => {
  const worker = new Worker(new URL("./testWorker.ts", import.meta.url).href);

  worker.postMessage({
    id: 1,
    method: "ping",
    params: undefined,
  });

  expect(await onceMessage(worker)).toEqual({
    id: 1,
    result: {
      ok: true,
      message: "pong",
    },
  });

  worker.terminate();
});

test("worker responds to init", async () => {
  const worker = new Worker(new URL("./testWorker.ts", import.meta.url).href);

  worker.postMessage({
    id: 2,
    method: "init",
    params: {
      dbName: "test.db",
      cipher: "sqlcipher",
      key: "secret",
    },
  });

  expect(await onceMessage(worker)).toEqual({
    id: 2,
    result: {
      ok: true,
    },
  });

  worker.terminate();
});

test("worker responds to exec", async () => {
  const worker = new Worker(new URL("./testWorker.ts", import.meta.url).href);

  worker.postMessage({
    id: 2,
    method: "init",
    params: {
      dbName: "test.db",
      cipher: "sqlcipher",
      key: "secret",
    },
  });

  await onceMessage(worker);

  worker.postMessage({
    id: 3,
    method: "exec",
    params: {
      sql: "SELECT 1 AS value",
      rowMode: "array",
    },
  });

  expect(await onceMessage(worker)).toEqual({
    id: 3,
    result: {
      ok: true,
      rows: [[1]],
    },
  });

  worker.terminate();
});

test("worker responds to close", async () => {
  const worker = new Worker(new URL("./testWorker.ts", import.meta.url).href);

  worker.postMessage({
    id: 6,
    method: "init",
    params: {
      dbName: "test.db",
      cipher: "sqlcipher",
      key: "secret",
    },
  });
  await onceMessage(worker);

  // Graceful shutdown: the worker closes its db (and, for the persistent
  // backend, releases its OPFS access handles) and acks.
  worker.postMessage({
    id: 7,
    method: "close",
    params: undefined,
  });
  expect(await onceMessage(worker)).toEqual({
    id: 7,
    result: { ok: true },
  });

  // After close the db is gone, so exec reports it is not initialized — proving
  // close actually released the handle rather than being a no-op ack.
  worker.postMessage({
    id: 8,
    method: "exec",
    params: { sql: "SELECT 1", rowMode: "array" },
  });
  expect(await onceMessage(worker)).toEqual({
    id: 8,
    result: {
      ok: false,
      message: "Database has not been initialized.",
    },
  });

  worker.terminate();
});

test("worker disconnects a renewed port after its graceful close", async () => {
  const worker = new Worker(new URL("./testWorker.ts", import.meta.url).href);
  const channel = new MessageChannel();
  channel.port1.start();
  worker.postMessage({ type: WORKER_CONNECT_PORT_MESSAGE_TYPE }, [
    channel.port2,
  ]);

  const closed = oncePortMessage(channel.port1);
  channel.port1.postMessage({ id: 9, method: "close", params: undefined });
  expect(await closed).toEqual({
    id: 9,
    result: { ok: true },
  });

  const disconnected = oncePortMessage(channel.port1);
  channel.port1.postMessage({ type: WORKER_DISCONNECT_PORT_MESSAGE_TYPE });
  expect(await disconnected).toEqual({
    type: WORKER_PORT_DISCONNECTED_MESSAGE_TYPE,
  });

  channel.port1.close();
  worker.terminate();
});

test("worker rejects repeat init", async () => {
  const worker = new Worker(new URL("./testWorker.ts", import.meta.url).href);

  worker.postMessage({
    id: 4,
    method: "init",
    params: {
      dbName: "test.db",
      cipher: "sqlcipher",
      key: "secret",
    },
  });

  await onceMessage(worker);

  worker.postMessage({
    id: 5,
    method: "init",
    params: {
      dbName: "test.db",
      cipher: "sqlcipher",
      key: "secret",
    },
  });

  expect(await onceMessage(worker)).toEqual({
    id: 5,
    result: {
      ok: false,
      message: "Database has already been initialized.",
    },
  });

  worker.terminate();
});
