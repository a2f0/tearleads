import { expect, test } from "bun:test";
import {
  isSerializationFailure,
  isTransientDatabaseFailure,
  isUniqueViolation,
} from "./databaseErrors";

function wrapped(code: string): Error {
  const driverError = Object.assign(new Error("driver failure"), { code });
  return new Error("Failed query", { cause: driverError });
}

test("classifies Postgres SQLSTATEs through the cause chain", () => {
  expect(isUniqueViolation(wrapped("23505"))).toBe(true);
  expect(isUniqueViolation(wrapped("23503"))).toBe(false);
  expect(isSerializationFailure(wrapped("40001"))).toBe(true);
  expect(isSerializationFailure(wrapped("40P01"))).toBe(true);
  expect(isSerializationFailure(wrapped("23505"))).toBe(false);
});

test("treats only connection failures as transient", () => {
  for (const code of [
    "PG_CONNECT_TIMEOUT",
    "PG_POOL_TIMEOUT",
    "PG_CONNECTION_UNAVAILABLE",
  ]) {
    expect(isTransientDatabaseFailure(wrapped(code))).toBe(true);
  }
  for (const code of [
    "23505",
    "40001",
    "SQLITE_BUSY",
    "HRANA_WEBSOCKET_ERROR",
  ]) {
    expect(isTransientDatabaseFailure(wrapped(code))).toBe(false);
  }
});
