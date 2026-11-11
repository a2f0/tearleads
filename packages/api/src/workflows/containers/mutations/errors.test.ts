import { expect, test } from "bun:test";
import { CONTAINER_MUTATION_ERROR_CODES } from "@tearleads/validators/response";
import {
  containerManifestAlreadyExists,
  mutationStateStale,
  runConflictBoundary,
} from "./errors";

test("container behavior failures assign stable protocol codes", () => {
  expect(mutationStateStale("Diagnostic changed")).toMatchObject({
    body: {
      code: CONTAINER_MUTATION_ERROR_CODES.stateStale,
      error: "Diagnostic changed",
    },
    status: 409,
  });
  expect(containerManifestAlreadyExists()).toMatchObject({
    body: {
      code: CONTAINER_MUTATION_ERROR_CODES.manifestAlreadyExists,
      error: "Container manifest already exists",
    },
    status: 409,
  });
});

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
