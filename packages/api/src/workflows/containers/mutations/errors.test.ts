import { expect, test } from "bun:test";
import { ContainerMutationError, runConflictBoundary } from "./errors";

test("runConflictBoundary hides predecessor fork constraint details", async () => {
  const databaseError = Object.assign(new Error("duplicate key"), {
    constraint: "container_key_epochs_predecessor_idx",
  });
  const queryError = new Error("Failed query", { cause: databaseError });

  const rejection = runConflictBoundary(() => Promise.reject(queryError));

  await expect(rejection).rejects.toEqual(
    new ContainerMutationError(
      "Container KEK predecessor already has a successor",
      409,
    ),
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
    new ContainerMutationError(
      "Container KEK predecessor already has a successor",
      409,
    ),
  );
});

test("runConflictBoundary does not classify arbitrary constraint-name text", async () => {
  const message =
    "request context mentioned container_key_epochs_predecessor_idx";
  const rejection = runConflictBoundary(() =>
    Promise.reject(new Error(message)),
  );

  await expect(rejection).rejects.toEqual(
    new ContainerMutationError(message, 409),
  );
});
