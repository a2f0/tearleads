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
