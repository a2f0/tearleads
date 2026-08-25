import { expect, test } from "bun:test";
import { KeyingVerificationError } from "@symcrypt/crypto";
import { DocumentSyncUpdateIsolationError } from "../documents/shared/documentSyncUpdateIsolation";
import { reportAndRethrowKeyingVerificationError } from "./error";

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
