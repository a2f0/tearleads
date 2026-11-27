import { afterEach, expect, test } from "bun:test";
import { createConnection, createServer, type Server } from "node:net";
import { userInfo } from "node:os";
import { parseLocalDatabaseUrl, startPostgresProxy } from "./postgresProxy";

const closers: Array<() => Promise<void>> = [];
afterEach(async () => {
  // Last opened, first closed: a server waits for its open connections.
  for (const close of closers.splice(0).reverse()) await close();
});

test("accepts only a named local database without TLS", () => {
  expect(() => parseLocalDatabaseUrl(undefined)).toThrow(/DATABASE_URL/);
  expect(() => parseLocalDatabaseUrl("mysql://localhost/db")).toThrow(
    /postgres/,
  );
  expect(() => parseLocalDatabaseUrl("postgres://db.example.com/x")).toThrow(
    /loopback/,
  );
  expect(() => parseLocalDatabaseUrl("postgres://localhost")).toThrow(
    /name a database/,
  );
  expect(() =>
    parseLocalDatabaseUrl("postgres://localhost/x?sslmode=require"),
  ).toThrow(/unencrypted/);
  const url = parseLocalDatabaseUrl("postgres://127.0.0.1:5433/scratch");
  expect(url.username).toBe(userInfo().username);
  expect(parseLocalDatabaseUrl("postgresql://me@[::1]/x").username).toBe("me");
});

/** A server that answers every frontend message with one ReadyForQuery. */
async function fakePostgres(): Promise<Server> {
  const server = createServer((socket) => {
    socket.on("data", () => {
      socket.write(Uint8Array.from([0x5a, 0, 0, 0, 5, 0x49]));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  closers.push(() => new Promise((resolve) => server.close(() => resolve())));
  return server;
}

test("relays both directions and counts them", async () => {
  const server = await fakePostgres();
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("No port.");
  const proxy = await startPostgresProxy(
    new URL(`postgres://me@127.0.0.1:${address.port}/scratch`),
  );
  closers.push(proxy.stop);
  const target = new URL(proxy.url);
  expect(target.pathname).toBe("/scratch");
  expect(target.username).toBe("me");
  const client = createConnection({
    host: target.hostname,
    port: Number(target.port),
  });
  closers.push(async () => {
    client.destroy();
  });
  const received = new Promise<number>((resolve) =>
    client.once("data", (chunk: Buffer) => resolve(chunk.length)),
  );
  // A protocol 3.0 startup packet with an empty parameter list.
  const startupPacket = new Uint8Array(9);
  new DataView(startupPacket.buffer).setInt32(0, 9);
  new DataView(startupPacket.buffer).setInt32(4, 196608);
  client.write(startupPacket);
  expect(await received).toBe(6);
  expect(proxy.snapshot()).toEqual({
    connections: 1,
    statements: 0,
    roundTrips: 1,
    rows: 0,
    bytesSent: 9,
    bytesReturned: 6,
  });
});
