import { expect, test } from "bun:test";
import { DATABASE_TRANSACTION_REVOKED_MESSAGE } from "../src/types";
import { OK_EMPTY, openLeaseTestDatabase } from "./leaseTestHarness";

test("a holder idle past the bound while another connection waits is rolled back and retired", async () => {
  const database = await openLeaseTestDatabase("lease-revoke", {
    leaseBounds: { idleMs: 50, waitMs: 5_000 },
  });
  const first = await database.connect();
  const second = await database.connect();

  await first.rows("BEGIN IMMEDIATE");
  await first.rows("INSERT INTO items (value) VALUES (1)");
  expect(await second.exec("INSERT INTO items (value) VALUES (2)")).toEqual(
    OK_EMPTY,
  );
  expect(await second.rows("SELECT value FROM items")).toEqual([[2]]);

  // The retired holder cannot run a statement as if its transaction were
  // still open, and recovers by opening the database again.
  const afterRevocation = await first.exec(
    "INSERT INTO items (value) VALUES (3)",
  );
  expect(afterRevocation.ok).toBe(false);
  expect(!afterRevocation.ok && afterRevocation.message).toStartWith(
    DATABASE_TRANSACTION_REVOKED_MESSAGE,
  );
  await database.init(first);
  expect(await first.rows("SELECT value FROM items")).toEqual([[2]]);
});

test("each revocation is logged with the database, the idle time, and the waiters, without SQL", async () => {
  const database = await openLeaseTestDatabase("lease-revoke-log", {
    leaseBounds: { idleMs: 50, waitMs: 5_000 },
  });
  const first = await database.connect();
  const second = await database.connect();
  const third = await database.connect();

  await first.rows("BEGIN IMMEDIATE");
  await first.rows("INSERT INTO items (value) VALUES (424242)");
  await Promise.all([
    second.rows("SELECT 'second-secret'"),
    third.rows("SELECT 'third-secret'"),
  ]);

  expect(database.logs).toHaveLength(1);
  const [log = ""] = database.logs;
  expect(log).toMatch(
    new RegExp(
      `^SQLite transaction lease revoked \\(database ${database.dbName}, idle \\d+ ms, 2 statement\\(s\\) waiting\\)\\.$`,
    ),
  );
  expect(log).not.toContain("424242");
  expect(log).not.toContain("secret");
  expect(log).not.toContain("INSERT");

  const refused = await first.exec("COMMIT");
  expect(!refused.ok && refused.message).toBe(
    `${DATABASE_TRANSACTION_REVOKED_MESSAGE} (database ${database.dbName}, ${log.slice(log.indexOf("idle"), -2)})`,
  );
});

test("a holder that keeps sending statements is never revoked", async () => {
  const database = await openLeaseTestDatabase("lease-active-holder", {
    leaseBounds: { idleMs: 60, waitMs: 5_000 },
  });
  const first = await database.connect();
  const second = await database.connect();

  await first.rows("BEGIN IMMEDIATE");
  const secondWrite = second.exec("INSERT INTO items (value) VALUES (2)");
  // Each statement arrives well inside the idle bound of the one before, for
  // longer than the bound in all.
  for (let value = 1; value <= 6; value += 1) {
    await Bun.sleep(25);
    await first.rows(`INSERT INTO items (value) VALUES (${value})`);
  }
  await first.rows("COMMIT");

  expect(await secondWrite).toEqual(OK_EMPTY);
  expect(database.logs).toEqual([]);
  expect(await first.rows("SELECT count(*) FROM items")).toEqual([[7]]);
});

test("a holder is not revoked while nobody waits", async () => {
  const database = await openLeaseTestDatabase("lease-alone", {
    leaseBounds: { idleMs: 20, waitMs: 5_000 },
  });
  const first = await database.connect();

  await first.rows("BEGIN IMMEDIATE");
  await first.rows("INSERT INTO items (value) VALUES (1)");
  await Bun.sleep(80);
  expect(await first.exec("COMMIT")).toEqual(OK_EMPTY);
  expect(database.logs).toEqual([]);
});
