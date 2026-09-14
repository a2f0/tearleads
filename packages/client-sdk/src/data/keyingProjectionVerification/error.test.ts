import { expect, test } from "bun:test";
import { KeyingVerificationError } from "@tearleads/crypto";
import { DocumentSyncUpdateIsolationError } from "../documents/shared/documentSyncUpdateIsolation";
import { DatabaseUnavailableError } from "../sync/databaseUnavailable";
import { ProjectionDependencyUnavailableError } from "./dependencyUnavailable";
import {
  reportAndRethrowKeyingVerificationError,
  throwKeyingVerificationErrorWithContext,
  throwKeyingVerificationShapeFailure,
} from "./error";
import { assertProjectionVerificationCurrent } from "./types";

function cancellation(): unknown {
  try {
    assertProjectionVerificationCurrent(() => false);
  } catch (error) {
    return error;
  }
  throw new Error("Expected a cancellation");
}

test("only plain verification errors are classified as received-material shape failures", () => {
  for (const shapeFailure of [
    new Error("manifest hash mismatch"),
    new SyntaxError("Unexpected token"),
  ]) {
    expect(() => throwKeyingVerificationShapeFailure(shapeFailure)).toThrow(
      expect.objectContaining({
        code: "invalid_shape",
        message: shapeFailure.message,
      }),
    );
  }
  const verificationError = new KeyingVerificationError(
    "hash_mismatch",
    "kept",
  );
  for (const preserved of [
    verificationError,
    new TypeError("Cannot read properties of undefined"),
    new RangeError("Invalid array length"),
    new ProjectionDependencyUnavailableError("signer unavailable"),
    new DatabaseUnavailableError("database gone"),
    cancellation(),
    "a foreign string throw",
  ]) {
    let thrown: unknown;
    try {
      throwKeyingVerificationShapeFailure(preserved);
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBe(preserved);
  }
});

test("adding verification context preserves retryable boundary errors", () => {
  for (const boundary of [
    new ProjectionDependencyUnavailableError("signer unavailable"),
    new DatabaseUnavailableError("database gone"),
    cancellation(),
  ]) {
    let thrown: unknown;
    try {
      throwKeyingVerificationErrorWithContext(boundary, "Group policy");
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBe(boundary);
  }
  expect(() =>
    throwKeyingVerificationErrorWithContext(new Error("plain"), "Group policy"),
  ).toThrow("Group policy: plain");
});

test("nested verification failures report without replacing their boundary", async () => {
  const verificationError = new KeyingVerificationError(
    "invalid_shape",
    "Future content-key epoch",
  );
  const isolationError = new DocumentSyncUpdateIsolationError({
    batchUpdateIds: ["550e8400-e29b-41d4-a716-4466554400aa"],
    cause: verificationError,
    stage: "content_key",
    updateId: null,
  });
  const reported: unknown[] = [];

  await expect(
    reportAndRethrowKeyingVerificationError(
      isolationError,
      async (error) => {
        reported.push(error);
      },
      {
        objectId: "document-1",
        objectKind: "document",
        operation: "document.sync",
      },
    ),
  ).rejects.toBe(isolationError);
  expect(reported).toEqual([verificationError]);
  expect(isolationError.attribution).toBe("batch");
  expect(isolationError.writerUserId).toBeNull();
});

test("verification cause traversal is bounded and cycle-safe", async () => {
  const cycle = new Error("cyclic boundary");
  Object.defineProperty(cycle, "cause", { value: cycle });
  let reported = false;

  await reportAndRethrowKeyingVerificationError(
    cycle,
    async () => {
      reported = true;
    },
    {
      objectId: null,
      objectKind: "unknown",
      operation: "test.cycle",
    },
  );

  expect(reported).toBe(false);
});
