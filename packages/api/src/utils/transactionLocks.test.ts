import { expect, test } from "bun:test";
import { db } from "@tearleads/api-shared/postgres";
import {
  acquireTransactionLock,
  recordTransactionLock,
  transactionHoldsLock,
} from "./transactionLocks";

test("a transaction re-acquires a lock only when it holds no covering mode", async () => {
  await db.transaction(async (tx) => {
    const acquired: string[] = [];
    const take = (key: string, mode: "exclusive" | "shared") =>
      acquireTransactionLock(tx, key, mode, async () => {
        acquired.push(`${key}:${mode}`);
      });

    await take("a", "shared");
    await take("a", "shared");
    // Shared does not cover exclusive: the upgrade must still be requested.
    await take("a", "exclusive");
    await take("a", "shared");
    await take("a", "exclusive");
    await take("b", "exclusive");
    await take("b", "shared");
    expect(acquired).toEqual(["a:shared", "a:exclusive", "b:exclusive"]);
  });
});

test("a failed acquisition is not recorded, and nothing is shared across transactions", async () => {
  await db.transaction(async (tx) => {
    await expect(
      acquireTransactionLock(tx, "c", "exclusive", () =>
        Promise.reject(new Error("deadlock")),
      ),
    ).rejects.toThrow("deadlock");
    expect(transactionHoldsLock(tx, "c", "exclusive")).toBe(false);
    recordTransactionLock(tx, "d", "exclusive");
    expect(transactionHoldsLock(tx, "d", "shared")).toBe(true);
  });
  await db.transaction(async (tx) => {
    expect(transactionHoldsLock(tx, "d", "shared")).toBe(false);
  });
  // The root executor holds no transaction locks, so it never records one.
  recordTransactionLock(db, "e", "exclusive");
  expect(transactionHoldsLock(db, "e", "exclusive")).toBe(false);
});
