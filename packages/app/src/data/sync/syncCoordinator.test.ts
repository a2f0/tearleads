import { expect, test } from "bun:test";
import { isDestroyedDatabaseClientError } from "./syncCoordinator";

test("isDestroyedDatabaseClientError follows wrapped error causes", () => {
  expect(
    isDestroyedDatabaseClientError(
      new Error("Failed query", {
        cause: new Error("Database worker client has been destroyed."),
      }),
    ),
  ).toBe(true);
});

test("isDestroyedDatabaseClientError detects wrapped teardown messages", () => {
  expect(
    isDestroyedDatabaseClientError(
      new Error(
        "Failed to sync document: Database worker client has been destroyed.",
      ),
    ),
  ).toBe(true);
});
