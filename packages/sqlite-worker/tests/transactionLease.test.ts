import { expect, test } from "bun:test";
import {
  DATABASE_DELETED_MESSAGE,
  DATABASE_NOT_INITIALIZED_MESSAGE,
  DATABASE_TRANSACTION_BUSY_MESSAGE,
} from "../src/types";
import {
  OK_EMPTY,
  openLeaseTestDatabase,
  stillPendingAfter,
} from "./leaseTestHarness";

// Every connection to a database in a worker shares one SQLite handle, so
// without the transaction lease one tab's statements ran inside another tab's
// open transaction (issue #3318). These tests are the issue's reproduction.

test("another connection's write waits for a transaction and survives its rollback", async () => {
  const database = await openLeaseTestDatabase("lease-rollback");
  const first = await database.connect();
  const second = await database.connect();

  await first.rows("BEGIN IMMEDIATE");
  await first.rows("INSERT INTO items (value) VALUES (1)");
  const secondWrite = second.exec("INSERT INTO items (value) VALUES (2)");
  expect(await stillPendingAfter(secondWrite, 50)).toBe(true);

  expect(await first.exec("ROLLBACK")).toEqual(OK_EMPTY);
  expect(await secondWrite).toEqual(OK_EMPTY);
  expect(await second.rows("SELECT value FROM items")).toEqual([[2]]);
});

test("a connection's failed BEGIN and its ROLLBACK leave another connection's transaction alone", async () => {
  const database = await openLeaseTestDatabase("lease-guarded-begin");
  const first = await database.connect();
  const second = await database.connect();

  await first.rows("BEGIN IMMEDIATE");
  await first.rows("INSERT INTO items (value) VALUES (1)");
  // A guarded transaction on another tab: BEGIN, and ROLLBACK if it fails.
  const secondTransaction = (async () => {
    const begin = await second.exec("BEGIN IMMEDIATE");
    if (!begin.ok) {
      await second.exec("ROLLBACK");
      return begin;
    }
    await second.rows("INSERT INTO items (value) VALUES (4)");
    return second.exec("COMMIT");
  })();
  await stillPendingAfter(secondTransaction, 50);

  await first.rows("INSERT INTO items (value) VALUES (3)");
  expect(await first.exec("ROLLBACK")).toEqual(OK_EMPTY);
  expect(await secondTransaction).toEqual(OK_EMPTY);

  // The first connection rolled back, so none of its rows may remain.
  expect(await first.rows("SELECT value FROM items")).toEqual([[4]]);
});

test("a transaction a SAVEPOINT opens holds the lease until its release", async () => {
  const database = await openLeaseTestDatabase("lease-savepoint");
  const first = await database.connect();
  const second = await database.connect();

  await first.rows("SAVEPOINT outer_sp");
  await first.rows("INSERT INTO items (value) VALUES (1)");
  const secondWrite = second.exec("INSERT INTO items (value) VALUES (2)");
  await first.rows("ROLLBACK TO SAVEPOINT outer_sp");
  expect(await stillPendingAfter(secondWrite, 50)).toBe(true);

  await first.rows("RELEASE SAVEPOINT outer_sp");
  expect(await secondWrite).toEqual(OK_EMPTY);
  expect(await second.rows("SELECT value FROM items")).toEqual([[2]]);
});

test("nested savepoints keep the lease until the outer transaction commits", async () => {
  const database = await openLeaseTestDatabase("lease-nested");
  const first = await database.connect();
  const second = await database.connect();

  await first.rows("BEGIN");
  await first.rows("SAVEPOINT inner_sp");
  await first.rows("INSERT INTO items (value) VALUES (1)");
  await first.rows("RELEASE SAVEPOINT inner_sp");
  const secondRead = second.exec("SELECT count(*) FROM items");
  expect(await stillPendingAfter(secondRead, 50)).toBe(true);

  await first.rows("COMMIT");
  expect(await secondRead).toEqual({ ok: true, rows: [[1]] });
});

test("a statement SQLite rolls back after it fails frees the lease", async () => {
  const database = await openLeaseTestDatabase("lease-or-rollback");
  const first = await database.connect();
  const second = await database.connect();
  await first.rows("CREATE TABLE keyed (id INTEGER PRIMARY KEY)");

  await first.rows("BEGIN");
  await first.rows("INSERT INTO keyed VALUES (1)");
  const secondWrite = second.exec("INSERT INTO items (value) VALUES (2)");
  expect(await stillPendingAfter(secondWrite, 50)).toBe(true);

  const conflict = await first.exec("INSERT OR ROLLBACK INTO keyed VALUES (1)");
  expect(conflict.ok).toBe(false);
  expect(await secondWrite).toEqual(OK_EMPTY);
  expect(await second.rows("SELECT count(*) FROM keyed")).toEqual([[0]]);
});

test("a multi-statement string that fails inside its own BEGIN keeps the lease", async () => {
  const database = await openLeaseTestDatabase("lease-batch");
  const first = await database.connect();
  const second = await database.connect();
  await first.rows("CREATE TABLE keyed (id INTEGER PRIMARY KEY)");

  const batch = await first.exec(
    "BEGIN; INSERT INTO keyed VALUES (1); INSERT INTO keyed VALUES (1)",
  );
  expect(batch.ok).toBe(false);
  const secondRead = second.exec("SELECT count(*) FROM keyed");
  expect(await stillPendingAfter(secondRead, 50)).toBe(true);

  await first.rows("ROLLBACK");
  expect(await secondRead).toEqual({ ok: true, rows: [[0]] });
});

test("closing the holder rolls its transaction back and frees the lease", async () => {
  const database = await openLeaseTestDatabase("lease-close");
  const first = await database.connect();
  const second = await database.connect();

  await first.rows("BEGIN IMMEDIATE");
  await first.rows("INSERT INTO items (value) VALUES (1)");
  const secondWrite = second.exec("INSERT INTO items (value) VALUES (2)");
  expect(await stillPendingAfter(secondWrite, 50)).toBe(true);

  expect(await first.send("close", undefined)).toEqual({ ok: true });
  expect(await secondWrite).toEqual(OK_EMPTY);
  expect(await second.rows("SELECT value FROM items")).toEqual([[2]]);

  await database.init(first);
  expect(await first.rows("SELECT value FROM items")).toEqual([[2]]);
});

test("waiting statements run in arrival order and the holder's own pass them", async () => {
  const database = await openLeaseTestDatabase("lease-order");
  const first = await database.connect();
  const second = await database.connect();
  const third = await database.connect();

  await first.rows("BEGIN");
  const secondWrite = second.exec("INSERT INTO items (value) VALUES (2)");
  const thirdWrite = third.exec("INSERT INTO items (value) VALUES (3)");
  await first.rows("INSERT INTO items (value) VALUES (1)");
  expect(await stillPendingAfter(secondWrite, 50)).toBe(true);

  await first.rows("COMMIT");
  expect(await Promise.all([secondWrite, thirdWrite])).toEqual([
    OK_EMPTY,
    OK_EMPTY,
  ]);
  expect(await first.rows("SELECT value FROM items ORDER BY rowid")).toEqual([
    [1],
    [2],
    [3],
  ]);
});

test("a statement past the wait bound is refused and never runs", async () => {
  const database = await openLeaseTestDatabase("lease-wait", {
    leaseBounds: { idleMs: 60_000, waitMs: 100 },
  });
  const first = await database.connect();
  const second = await database.connect();

  await first.rows("BEGIN IMMEDIATE");
  await first.rows("INSERT INTO items (value) VALUES (1)");
  const refused = await second.exec("INSERT INTO items (value) VALUES (2)");
  expect(refused).toEqual({
    ok: false,
    message: DATABASE_TRANSACTION_BUSY_MESSAGE,
  });

  await first.rows("COMMIT");
  expect(await second.rows("SELECT value FROM items")).toEqual([[1]]);
  expect(await second.exec("INSERT INTO items (value) VALUES (2)")).toEqual(
    OK_EMPTY,
  );
  expect(database.logs).toEqual([]);
});

test("closing a connection refuses its waiting statements", async () => {
  const database = await openLeaseTestDatabase("lease-close-waiter");
  const first = await database.connect();
  const second = await database.connect();

  await first.rows("BEGIN IMMEDIATE");
  const secondWrite = second.exec("INSERT INTO items (value) VALUES (2)");
  expect(await stillPendingAfter(secondWrite, 20)).toBe(true);
  expect(await second.send("close", undefined)).toEqual({ ok: true });
  expect(await secondWrite).toEqual({
    ok: false,
    message: DATABASE_NOT_INITIALIZED_MESSAGE,
  });

  await first.rows("COMMIT");
  expect(await first.rows("SELECT value FROM items")).toEqual([]);
});

test("deleting the database refuses another connection's waiting statements", async () => {
  const database = await openLeaseTestDatabase("lease-delete");
  const first = await database.connect();
  const second = await database.connect();

  await first.rows("BEGIN IMMEDIATE");
  const secondWrite = second.exec("INSERT INTO items (value) VALUES (2)");
  expect(await stillPendingAfter(secondWrite, 20)).toBe(true);

  expect(await first.send("delete", undefined)).toEqual({ ok: true });
  expect(await secondWrite).toEqual({
    ok: false,
    message: DATABASE_DELETED_MESSAGE,
  });
  expect(second.notices).toHaveLength(1);
});
