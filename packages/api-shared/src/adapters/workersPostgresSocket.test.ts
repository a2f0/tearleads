import { expect, test } from "bun:test";
import { Buffer } from "node:buffer";
import {
  WorkersPostgresSocket,
  type WorkersSocket,
} from "./workersPostgresSocket";

function fakeSocket() {
  const writes: Buffer[] = [];
  let closed = false;
  let resolveClosed = () => {};
  const socket: WorkersSocket = {
    closed: new Promise<void>((resolve) => {
      resolveClosed = resolve;
    }),
    readable: new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("S"));
      },
    }),
    writable: new WritableStream<Uint8Array>({
      write(chunk) {
        writes.push(Buffer.from(chunk));
      },
    }),
    close: async () => {
      closed = true;
      resolveClosed();
    },
    startTls: () => socket,
  };
  return { socket, writes, isClosed: () => closed };
}

async function settled(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

test("one tick's protocol messages reach the socket as a single write", async () => {
  const fake = fakeSocket();
  const stream = new WorkersPostgresSocket(
    false,
    async () => () => fake.socket,
  );
  const received: string[] = [];
  stream.on("data", (chunk: Buffer) => received.push(String(chunk)));
  const connected = new Promise<void>((resolve) =>
    stream.once("connect", resolve),
  );
  await stream.connect(5432, "db.example.test");
  await connected;
  const callbacks: string[] = [];
  stream.write(Buffer.from("parse"), "utf8", () => callbacks.push("parse"));
  stream.write("bind", "utf8", () => callbacks.push("bind"));
  stream.write(Buffer.alloc(0), "utf8", () => callbacks.push("flush"));
  expect(fake.writes).toEqual([]);
  await settled();
  expect(fake.writes.map(String)).toEqual(["parsebind"]);
  expect(callbacks).toEqual(["parse", "bind", "flush"]);
  expect(received).toEqual(["S"]);
});

test("ending the stream flushes queued writes before closing the socket", async () => {
  const fake = fakeSocket();
  const stream = new WorkersPostgresSocket(true, async () => () => fake.socket);
  await stream.connect(5432, "db.example.test");
  const closed = new Promise<void>((resolve) => stream.once("close", resolve));
  stream.write("terminate");
  stream.end();
  await closed;
  expect(fake.writes.map(String)).toEqual(["terminate"]);
  expect(fake.isClosed()).toBe(true);
});

test("write and end accept a callback in place of the encoding", async () => {
  const fake = fakeSocket();
  const stream = new WorkersPostgresSocket(
    false,
    async () => () => fake.socket,
  );
  await stream.connect(5432, "db.example.test");
  const order: string[] = [];
  stream.write("X", () => order.push("terminate-written"));
  const closed = new Promise<void>((resolve) => stream.once("close", resolve));
  stream.end(Buffer.alloc(0), () => order.push("ended"));
  await closed;
  expect(fake.writes.map(String)).toEqual(["X"]);
  expect(order).toEqual(["terminate-written", "ended"]);
});
