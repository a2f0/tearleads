import { afterAll, afterEach, expect, mock, spyOn, test } from "bun:test";
import { EventEmitter } from "node:events";
import pg, { type PoolClient } from "pg";
import { PostgresPool } from "./postgresPool";

const connect = spyOn(pg.Pool.prototype, "connect");
afterEach(() => connect.mockReset());
afterAll(() => connect.mockRestore());

function fakeClient(queryError?: Error) {
  const query = mock(
    (_sql: unknown, _values: unknown, done: (error?: Error) => void) =>
      queueMicrotask(() => done(queryError)),
  );
  const release = mock(() => {});
  const client = Object.assign(new EventEmitter(), {
    query,
    release,
  }) as unknown as PoolClient;
  return { client, query, release };
}

test("a transaction can acquire a client after one transient connection failure", async () => {
  const { client } = fakeClient();
  let attempts = 0;
  connect.mockImplementation(() => {
    if (++attempts === 1)
      return Promise.reject(
        new Error("Connection terminated due to connection timeout"),
      );
    return Promise.resolve(client);
  });
  const pool = new PostgresPool();
  expect(await pool.connect()).toBe(client);
  expect(attempts).toBe(2);
});

test("Pool.query retries acquisition and sends its statement exactly once", async () => {
  const { client, query, release } = fakeClient();
  let attempts = 0;
  connect.mockImplementation(() => {
    if (++attempts === 1)
      return Promise.reject(
        Object.assign(new Error("private"), { code: "ECONNRESET" }),
      );
    return Promise.resolve(client);
  });
  const pool = new PostgresPool();
  await pool.query("insert into synthetic_table values ($1)", ["private"]);
  expect(attempts).toBe(2);
  expect(query).toHaveBeenCalledTimes(1);
  expect(release).toHaveBeenCalledTimes(1);
});

test("a query failure is never retried after acquiring its client", async () => {
  const error = Object.assign(new Error("private"), { code: "ECONNRESET" });
  const { client, query, release } = fakeClient(error);
  connect.mockImplementation(() => Promise.resolve(client));
  const pool = new PostgresPool();
  await expect(
    pool.query("insert into synthetic_table values (1)"),
  ).rejects.toBe(error);
  expect(connect).toHaveBeenCalledTimes(1);
  expect(query).toHaveBeenCalledTimes(1);
  expect(release).toHaveBeenCalledTimes(1);
});

test.each([
  ["timeout exceeded when trying to connect", "PG_POOL_TIMEOUT"],
  ["Connection terminated due to connection timeout", "PG_CONNECT_TIMEOUT"],
])(
  "exhausted %s is bounded and carries safe pool diagnostics",
  async (message, code) => {
    const cause = new Error(message);
    connect.mockImplementation(() => Promise.reject(cause));
    const pool = new PostgresPool();
    await expect(pool.connect()).rejects.toMatchObject({
      name: "PostgresConnectionError",
      code,
      cause,
      databaseStage: "connect",
      connectionAttempts: 2,
      poolTotal: 0,
      poolIdle: 0,
      poolWaiting: 0,
    });
    expect(connect).toHaveBeenCalledTimes(2);
  },
);

test("authentication failures are preserved without retry", async () => {
  const cause = Object.assign(new Error("private credentials"), {
    code: "28P01",
  });
  connect.mockImplementation(() => Promise.reject(cause));
  await expect(new PostgresPool().connect()).rejects.toMatchObject({
    code: "PG_CONNECTION_FAILED",
    connectionAttempts: 1,
    message:
      "Database connection acquisition failed (PG_CONNECTION_FAILED; 28P01)",
    cause,
  });
  expect(connect).toHaveBeenCalledTimes(1);
});

test("Pool.query rejects exhausted acquisition without executing SQL", async () => {
  connect.mockImplementation(() =>
    Promise.reject(
      new Error("Connection terminated due to connection timeout"),
    ),
  );
  const pool = new PostgresPool();
  await expect(pool.query("select 1")).rejects.toMatchObject({
    name: "PostgresConnectionError",
    code: "PG_CONNECT_TIMEOUT",
    connectionAttempts: 2,
  });
  expect(connect).toHaveBeenCalledTimes(2);
});

test("a pool that starts shutting down does not retry acquisition", async () => {
  const pool = new PostgresPool();
  connect.mockImplementation(async () => {
    await pool.end();
    throw new Error("Connection terminated due to connection timeout");
  });
  await expect(pool.connect()).rejects.toMatchObject({ connectionAttempts: 1 });
  expect(connect).toHaveBeenCalledTimes(1);
});
