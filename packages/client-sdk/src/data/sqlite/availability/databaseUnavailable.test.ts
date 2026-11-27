import { expect, test } from "bun:test";
import { KeyingVerificationError } from "@tearleads/crypto";
import { DATABASE_TRANSACTION_BUSY_MESSAGE } from "@tearleads/sqlite-worker/types";
import {
  DatabaseUnavailableError,
  isDatabaseTransactionBusyError,
  isDatabaseUnavailableError,
} from "./databaseUnavailable";

test("isDatabaseUnavailableError recognizes a DatabaseUnavailableError", () => {
  expect(
    isDatabaseUnavailableError(
      new DatabaseUnavailableError("trust store gone"),
    ),
  ).toBe(true);
  expect(
    isDatabaseUnavailableError(
      new Error("Failed lane", {
        cause: new DatabaseUnavailableError("trust store gone"),
      }),
    ),
  ).toBe(true);
});

test("isDatabaseUnavailableError follows wrapped teardown messages", () => {
  expect(
    isDatabaseUnavailableError(
      new Error("Failed query", {
        cause: new Error("Database worker client has been destroyed."),
      }),
    ),
  ).toBe(true);
  expect(
    isDatabaseUnavailableError(
      new Error(
        "Failed to sync document: Database worker client has been destroyed.",
      ),
    ),
  ).toBe(true);
  expect(
    isDatabaseUnavailableError(new Error("Database client is unavailable.")),
  ).toBe(true);
  expect(isDatabaseUnavailableError(new Error("other"))).toBe(false);
});

test("isDatabaseUnavailableError does not swallow keying failures", () => {
  // The trust-store check used to share missing_dependency with the trust-domain
  // check beside it, and that code covers genuine keying failures elsewhere.
  // Discriminating on the code rather than the type would silence all of them.
  expect(
    isDatabaseUnavailableError(
      new KeyingVerificationError(
        "missing_dependency",
        "Trusted user identity resolution requires a stable API trust domain",
      ),
    ),
  ).toBe(false);
});

test("isDatabaseTransactionBusyError finds the worker's refusal through its wrappers", () => {
  const busy = new Error(DATABASE_TRANSACTION_BUSY_MESSAGE);
  expect(isDatabaseTransactionBusyError(busy)).toBe(true);
  expect(
    isDatabaseTransactionBusyError(
      new Error("Failed query: SELECT 1", { cause: busy }),
    ),
  ).toBe(true);
  // A busy database is open and will serve the work: not "unavailable", whose
  // callers wait for the database to come back instead of retrying.
  expect(isDatabaseUnavailableError(busy)).toBe(false);
  expect(isDatabaseTransactionBusyError(new Error("no such table: t"))).toBe(
    false,
  );
  expect(isDatabaseTransactionBusyError("a foreign string throw")).toBe(false);

  const cycle = new Error("cyclic");
  Object.defineProperty(cycle, "cause", { value: cycle });
  expect(isDatabaseTransactionBusyError(cycle)).toBe(false);
});
