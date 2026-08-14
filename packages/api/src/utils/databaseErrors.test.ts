import { expect, test } from "bun:test";
import { isLockContention, isTransientDatabaseFailure } from "./databaseErrors";

test("classifies libSQL transaction interruption as transient, not conflict", () => {
  for (const code of ["STREAM_EXPIRED", "TRANSACTION_TIMEOUT"]) {
    const driverError = Object.assign(new Error("transaction interrupted"), {
      code,
    });
    const wrappedError = new Error("Failed query", { cause: driverError });

    expect(isLockContention(wrappedError)).toBe(false);
    expect(isTransientDatabaseFailure(wrappedError)).toBe(true);
  }
});

test("classifies transient libSQL transport failures without masking config errors", () => {
  for (const code of [
    "HRANA_CLOSED_ERROR",
    "HRANA_PROTO_ERROR",
    "HRANA_WEBSOCKET_ERROR",
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

test("retries only transient libSQL HTTP server statuses", () => {
  for (const status of [408, 429, 500, 503]) {
    const httpError = Object.assign(new Error("HTTP request failed"), {
      status,
    });
    const serverError = Object.assign(
      new Error("Remote database request failed", { cause: httpError }),
      { code: "SERVER_ERROR" },
    );

    expect(isTransientDatabaseFailure(serverError)).toBe(true);
  }

  for (const status of [400, 401, 403, 404]) {
    const httpError = Object.assign(new Error("HTTP request failed"), {
      status,
    });
    const serverError = Object.assign(
      new Error("Remote database request failed", { cause: httpError }),
      { code: "SERVER_ERROR" },
    );

    expect(isTransientDatabaseFailure(serverError)).toBe(false);
  }
});
