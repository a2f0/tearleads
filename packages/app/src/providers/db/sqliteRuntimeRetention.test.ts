import { expect, test } from "bun:test";
import {
  createRetryableSQLiteRuntimeFactory,
  createReusableSQLiteRuntimeFactory,
} from "../../../test/helpers/databaseRuntimeFactories";
import {
  logSQLiteRuntimeReuseUnavailable,
  resetReusableSQLiteRuntimeDatabase,
  SQLiteRuntimeResetError,
} from "./sqliteRuntimeRetention";

test("logs when an opted-in live runtime loses renewal capability", () => {
  const runtime = createRetryableSQLiteRuntimeFactory().createSQLiteRuntime();
  const logs: string[] = [];

  logSQLiteRuntimeReuseUnavailable(true, runtime, (message) => {
    logs.push(message);
  });

  expect(logs).toEqual([
    "Database worker reuse was requested, but the live runtime no longer supports renewClient; terminating it instead.",
  ]);
});

test("a close timeout terminates instead of reusing an open database", async () => {
  const runtimeFactory = createReusableSQLiteRuntimeFactory({
    deferClose: true,
  });
  const runtime = runtimeFactory.createSQLiteRuntime();

  await expect(
    resetReusableSQLiteRuntimeDatabase(runtime, "close", 1),
  ).rejects.toBeInstanceOf(SQLiteRuntimeResetError);
  expect(runtimeFactory.getStats()).toMatchObject({
    closeCount: 1,
    renewCount: 0,
    terminateCount: 1,
  });
});

test("a delete failure terminates instead of retaining an unpurged worker", async () => {
  const runtimeFactory = createReusableSQLiteRuntimeFactory({
    deleteError: new Error("planned delete failure"),
  });
  const runtime = runtimeFactory.createSQLiteRuntime();

  await expect(
    resetReusableSQLiteRuntimeDatabase(runtime, "delete"),
  ).rejects.toBeInstanceOf(SQLiteRuntimeResetError);
  expect(runtimeFactory.getStats()).toMatchObject({
    clientDeleteCount: 1,
    renewCount: 0,
    terminateCount: 1,
  });
});
