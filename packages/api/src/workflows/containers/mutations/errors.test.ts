import { expect, test } from "bun:test";
import { CONTAINER_MUTATION_ERROR_CODES } from "@tearleads/validators/response";
import {
  containerManifestAlreadyExists,
  containerSystemSlotTaken,
  mutationStateStale,
  runConflictBoundary,
} from "./errors";

const DRIVER_MESSAGE =
  'Failed query: insert into "containers" ("id", "system_slot") values ($1, $2)\nparams: 7f2aa953,sys_v1_slot';

async function rejectionBody(error: unknown) {
  try {
    await runConflictBoundary(() => Promise.reject(error));
  } catch (caught) {
    return Reflect.get(Object(caught), "body");
  }
  throw new Error("Expected runConflictBoundary to reject");
}

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

test("runConflictBoundary maps coded unique violations to a 409 without driver text", async () => {
  const databaseError = Object.assign(new Error("duplicate key"), {
    code: "23505",
  });
  const queryError = new Error(DRIVER_MESSAGE, { cause: databaseError });

  const rejection = runConflictBoundary(() => Promise.reject(queryError));

  await expect(rejection).rejects.toEqual(
    mutationStateStale("Container state changed concurrently"),
  );
  expect(JSON.stringify(await rejectionBody(queryError))).not.toContain(
    "insert",
  );
});

test("runConflictBoundary maps serialization failures to a 409 without driver text", async () => {
  const databaseError = Object.assign(new Error("could not serialize access"), {
    code: "40001",
  });
  const queryError = new Error(DRIVER_MESSAGE, { cause: databaseError });

  expect(await rejectionBody(queryError)).toEqual({
    code: CONTAINER_MUTATION_ERROR_CODES.stateStale,
    error: "Container state changed concurrently",
  });
});

test("runConflictBoundary maps a taken system slot to a final, uncoded conflict", async () => {
  const databaseError = Object.assign(
    new Error(
      'duplicate key value violates unique constraint "containers_org_system_slot_idx"',
    ),
    { code: "23505", constraint: "containers_org_system_slot_idx" },
  );
  const queryError = new Error(DRIVER_MESSAGE, { cause: databaseError });

  await expect(
    runConflictBoundary(() => Promise.reject(queryError)),
  ).rejects.toEqual(containerSystemSlotTaken());
  expect(await rejectionBody(queryError)).toEqual({
    error: "Container system slot is already taken",
    systemSlotTaken: true,
  });
});
