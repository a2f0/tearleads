import { expect, test } from "bun:test";
import {
  mutationStateStale,
  runConflictBoundary,
  toMutationError,
} from "./errors";

test("runConflictBoundary hides predecessor fork constraint details", async () => {
  const databaseError = Object.assign(new Error("duplicate key"), {
    constraint: "container_key_epochs_predecessor_idx",
  });
  const queryError = new Error("Failed query", { cause: databaseError });

  const rejection = runConflictBoundary(() => Promise.reject(queryError));

  await expect(rejection).rejects.toEqual(
    mutationStateStale("Container KEK predecessor already has a successor"),
  );
});

test("runConflictBoundary recognizes the exact SQLite predecessor constraint", async () => {
  const rejection = runConflictBoundary(() =>
    Promise.reject(
      new Error(
        "UNIQUE constraint failed: container_key_epochs.predecessor_container_key_epoch_id",
      ),
    ),
  );

  await expect(rejection).rejects.toEqual(
    mutationStateStale("Container KEK predecessor already has a successor"),
  );
});

test("runConflictBoundary propagates arbitrary constraint-name text unwrapped", async () => {
  const message =
    "request context mentioned container_key_epochs_predecessor_idx";
  const original = new Error(message);
  const rejection = runConflictBoundary(() => Promise.reject(original));

  // Not a database conflict: it must reach the 500 handler as-is, not become
  // a retriable 409.
  await expect(rejection).rejects.toBe(original);
});

test("runConflictBoundary maps coded unique violations to a 409", async () => {
  const databaseError = Object.assign(new Error("duplicate key"), {
    code: "23505",
  });
  const queryError = new Error("Failed query", { cause: databaseError });

  const rejection = runConflictBoundary(() => Promise.reject(queryError));

  await expect(rejection).rejects.toEqual(mutationStateStale("Failed query"));
});

test("libSQL transaction interruption maps to a retryable conflict", async () => {
  const transactionError = Object.assign(new Error("transaction expired"), {
    code: "STREAM_EXPIRED",
  });

  expect(toMutationError(transactionError)).toEqual(
    mutationStateStale("Container mutation transaction conflicted; retry"),
  );
  await expect(
    runConflictBoundary(() => Promise.reject(transactionError)),
  ).rejects.toEqual(mutationStateStale("transaction expired"));
});
