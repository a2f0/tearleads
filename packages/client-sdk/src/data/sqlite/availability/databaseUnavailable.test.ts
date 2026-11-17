import { expect, test } from "bun:test";
import { KeyingVerificationError } from "@tearleads/crypto";
import {
  DatabaseUnavailableError,
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
