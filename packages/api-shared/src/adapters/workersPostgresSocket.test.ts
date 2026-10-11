import { expect, test } from "bun:test";
import { Buffer } from "node:buffer";
import {
  WorkersPostgresSocket,
  type WorkersSocket,
  type WorkersTlsOptions,
} from "./workersPostgresSocket";

function fakeSocket(
  options: {
    readonly initialData?: string;
    readonly tls?: ReturnType<typeof fakeSocket>;
    readonly writeError?: Error;
  } = {},
) {
  const writes: Buffer[] = [];
  const tlsOptions: WorkersTlsOptions[] = [];
  let closed = false;
  let resolveClosed = () => {};
  let rejectClosed = (_error: Error) => {};
  let push = (_data: string) => {};
  const socket: WorkersSocket = {
    closed: new Promise<void>((resolve, reject) => {
      resolveClosed = resolve;
      rejectClosed = reject;
    }),
    readable: new ReadableStream<Uint8Array>({
      start(controller) {
        push = (data) => controller.enqueue(new TextEncoder().encode(data));
        if (options.initialData !== undefined) {
          push(options.initialData);
        }
      },
    }),
    writable: new WritableStream<Uint8Array>({
      write(chunk) {
        if (options.writeError) {
          throw options.writeError;
        }
        writes.push(Buffer.from(chunk));
      },
    }),
    close: async () => {
      closed = true;
      resolveClosed();
    },
    startTls: (tls = {}) => {
      tlsOptions.push(tls);
      // The runtime settles the plain socket once TLS takes it over.
      resolveClosed();
      return options.tls?.socket ?? socket;
    },
  };
  return {
    socket,
    writes,
    tlsOptions,
    isClosed: () => closed,
    push: (data: string) => push(data),
    fail: (error: Error) => rejectClosed(error),
  };
}

function plainSocket() {
  return fakeSocket({ initialData: "S" });
}

async function settled(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

test("one tick's protocol messages reach the socket as a single write", async () => {
  const fake = plainSocket();
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
  const fake = plainSocket();
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
  const fake = plainSocket();
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

test("STARTTLS reads one byte on the plain socket, then moves to the TLS socket", async () => {
  const tls = fakeSocket();
  const plain = fakeSocket({ initialData: "SX", tls });
  const requested: WorkersSocketOptionsSeen[] = [];
  const stream = new WorkersPostgresSocket(
    true,
    async () => (address, options) => {
      requested.push({ address, secureTransport: options?.secureTransport });
      return plain.socket;
    },
  );
  const received: string[] = [];
  const closes: string[] = [];
  stream.on("data", (chunk: Buffer) => received.push(String(chunk)));
  stream.on("close", () => closes.push("close"));
  await stream.connect(5432, "db.example.test");
  await settled();
  expect(requested).toEqual([
    { address: "db.example.test:5432", secureTransport: "starttls" },
  ]);
  // pg reads the server's answer and, on "S", upgrades the stream.
  expect(received).toEqual(["SX"]);
  stream.startTls({ expectedServerHostname: "db.example.test" });
  stream.write("startup");
  await settled();
  expect(tls.tlsOptions).toEqual([]);
  expect(plain.tlsOptions).toEqual([
    { expectedServerHostname: "db.example.test" },
  ]);
  expect(plain.writes).toEqual([]);
  expect(tls.writes.map(String)).toEqual(["startup"]);
  tls.push("R");
  await settled();
  expect(received).toEqual(["SX", "R"]);
  // The plain socket settling during the upgrade is not a close.
  expect(closes).toEqual([]);
  await tls.socket.close();
  await settled();
  expect(closes).toEqual(["close"]);
});

test("a second TLS upgrade is reported instead of applied", async () => {
  const plain = fakeSocket({ initialData: "S", tls: fakeSocket() });
  const stream = new WorkersPostgresSocket(
    true,
    async () => () => plain.socket,
  );
  const errors: string[] = [];
  stream.on("error", (error: Error) => errors.push(error.message));
  await stream.connect(5432, "db.example.test");
  stream.startTls({});
  await settled();
  stream.startTls({});
  expect(errors).toEqual(["Cannot start TLS twice on one socket"]);
  expect(plain.tlsOptions).toHaveLength(1);
});

test("a refused connection is reported through the error event", async () => {
  const stream = new WorkersPostgresSocket(true, async () => () => {
    throw new Error("connection refused");
  });
  const errors: string[] = [];
  stream.on("error", (error: Error) => errors.push(error.message));
  expect(await stream.connect(5432, "db.example.test")).toBeUndefined();
  expect(errors).toEqual(["connection refused"]);
  expect(stream.writable).toBe(false);
});

test("a TLS socket that closes before any data names the failed negotiation", async () => {
  const tls = fakeSocket();
  const plain = fakeSocket({ initialData: "S", tls });
  const stream = new WorkersPostgresSocket(
    true,
    async () => () => plain.socket,
  );
  const events: string[] = [];
  stream.on("error", (error: Error) => events.push(`error:${error.message}`));
  stream.on("close", () => events.push("close"));
  await stream.connect(5432, "db.example.test");
  stream.startTls({ expectedServerHostname: "db.example.test" });
  await settled();
  await tls.socket.close();
  await settled();
  expect(events).toEqual([
    "error:TLS negotiation with the database failed: the server's certificate was not accepted or the connection closed during the handshake",
    "close",
  ]);
});

test("a TLS socket that answered before closing closes quietly", async () => {
  const tls = fakeSocket();
  const plain = fakeSocket({ initialData: "S", tls });
  const stream = new WorkersPostgresSocket(
    true,
    async () => () => plain.socket,
  );
  const events: string[] = [];
  stream.on("error", (error: Error) => events.push(`error:${error.message}`));
  stream.on("close", () => events.push("close"));
  stream.on("data", (chunk: Buffer) => events.push(`data:${String(chunk)}`));
  await stream.connect(5432, "db.example.test");
  stream.startTls({ expectedServerHostname: "db.example.test" });
  await settled();
  tls.push("R");
  await settled();
  await tls.socket.close();
  await settled();
  expect(events).toEqual(["data:S", "data:R", "close"]);
});

test("a TLS failure after the upgrade surfaces as a stream error", async () => {
  const tls = fakeSocket();
  const plain = fakeSocket({ initialData: "S", tls });
  const stream = new WorkersPostgresSocket(
    true,
    async () => () => plain.socket,
  );
  const errors: string[] = [];
  stream.on("error", (error: Error) => errors.push(error.message));
  await stream.connect(5432, "db.example.test");
  stream.startTls({ expectedServerHostname: "db.example.test" });
  tls.fail(new Error("certificate name mismatch"));
  await settled();
  expect(errors).toEqual(["certificate name mismatch"]);
});

test("a failed write fails the stream even without write callbacks", async () => {
  const plain = fakeSocket({
    initialData: "S",
    writeError: new Error("socket reset"),
  });
  const stream = new WorkersPostgresSocket(
    false,
    async () => () => plain.socket,
  );
  const events: string[] = [];
  stream.on("error", (error: Error) => events.push(`error:${error.message}`));
  stream.on("close", () => events.push("close"));
  await stream.connect(5432, "db.example.test");
  stream.write("query");
  await settled();
  await settled();
  expect(events).toEqual(["error:socket reset", "close"]);
  expect(plain.isClosed()).toBe(true);
});

interface WorkersSocketOptionsSeen {
  readonly address: string;
  readonly secureTransport: string | undefined;
}
