import { expect, test } from "bun:test";
import { isLockContention, isTransientDatabaseFailure } from "./databaseErrors";

test("classifies libSQL transaction contention through driver wrappers", () => {
  for (const code of ["STREAM_EXPIRED", "TRANSACTION_TIMEOUT"]) {
    const driverError = Object.assign(new Error("transaction interrupted"), {
      code,
    });
    const wrappedError = new Error("Failed query", { cause: driverError });

    expect(isLockContention(wrappedError)).toBe(true);
    expect(isTransientDatabaseFailure(wrappedError)).toBe(true);
  }
});

test("classifies transient libSQL transport failures without masking config errors", () => {
  for (const code of [
    "HRANA_CLOSED_ERROR",
    "HRANA_PROTO_ERROR",
    "HRANA_WEBSOCKET_ERROR",
    "SERVER_ERROR",
  ]) {
    expect(
      isTransientDatabaseFailure(
        Object.assign(new Error("remote database unavailable"), { code }),
      ),
    ).toBe(true);
  }

  expect(
    isTransientDatabaseFailure(
      Object.assign(new Error("invalid database URL"), {
        code: "URL_INVALID",
      }),
    ),
  ).toBe(false);
});
