import { expect, test } from "bun:test";
import { DATABASE_TRANSACTION_BUSY_MESSAGE } from "@tearleads/sqlite-worker/types";
import {
  classifyDatabaseFailure,
  DATABASE_BUSY_RUN_LIMIT,
  retryWhileDatabaseBusy,
} from "./databaseBusyRetry";
import { DatabaseUnavailableError } from "./databaseUnavailable";

const busy = () =>
  new Error("Failed query: SELECT 1", {
    cause: new Error(DATABASE_TRANSACTION_BUSY_MESSAGE),
  });

test("classifyDatabaseFailure separates busy, unavailable, and the work's own failures", () => {
  expect(classifyDatabaseFailure(busy())).toBe("busy");
  expect(
    classifyDatabaseFailure(new DatabaseUnavailableError("database gone")),
  ).toBe("unavailable");
  expect(
    classifyDatabaseFailure(
      new Error("Database worker client has been destroyed."),
    ),
  ).toBe("unavailable");
  expect(classifyDatabaseFailure(new Error("no such table: t"))).toBe("failed");
  expect(classifyDatabaseFailure("a foreign string throw")).toBe("failed");
});

test("retryWhileDatabaseBusy runs refused work again until it succeeds", async () => {
  let runs = 0;
  const refusals: number[] = [];
  const result = await retryWhileDatabaseBusy(
    async () => {
      runs += 1;
      if (runs < 3) throw busy();
      return "done";
    },
    { onBusy: (count) => refusals.push(count) },
  );
  expect(result).toBe("done");
  expect(runs).toBe(3);
  expect(refusals).toEqual([1, 2]);
});

test("retryWhileDatabaseBusy gives up with the refusal after its run limit", async () => {
  let runs = 0;
  const refusal = busy();
  await expect(
    retryWhileDatabaseBusy(async () => {
      runs += 1;
      throw refusal;
    }),
  ).rejects.toBe(refusal);
  expect(runs).toBe(DATABASE_BUSY_RUN_LIMIT);
});

test("retryWhileDatabaseBusy throws any other failure at once", async () => {
  let runs = 0;
  const failure = new Error("constraint failed");
  await expect(
    retryWhileDatabaseBusy(async () => {
      runs += 1;
      throw failure;
    }),
  ).rejects.toBe(failure);
  expect(runs).toBe(1);
});

test("retryWhileDatabaseBusy stops once its work is superseded", async () => {
  let runs = 0;
  let current = true;
  const refusal = busy();
  await expect(
    retryWhileDatabaseBusy(
      async () => {
        runs += 1;
        throw refusal;
      },
      {
        isCurrent: () => current,
        onBusy: () => {
          current = false;
        },
      },
    ),
  ).rejects.toBe(refusal);
  expect(runs).toBe(1);
});
