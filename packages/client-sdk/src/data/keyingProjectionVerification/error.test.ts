import { expect, test } from "bun:test";
import { KeyingVerificationError } from "@tearleads/crypto";
import { DocumentSyncUpdateIsolationError } from "../documents/shared/documentSyncUpdateIsolation";
import {
  isStaleCitationError,
  reportAndRethrowKeyingVerificationError,
} from "./error";

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

test("a stale ancestor citation stops the boundary without an incident", async () => {
  // The device cannot tell that ordering from a forgery and must wait for a
  // later event on the container; it is not a trust-boundary failure.
  const staleCitation = new KeyingVerificationError(
    "stale_citation",
    "path[1] cites a stale head of ancestor container root",
  );
  const reported: unknown[] = [];

  expect(isStaleCitationError(staleCitation)).toBe(true);
  await expect(
    reportAndRethrowKeyingVerificationError(
      staleCitation,
      async (error) => {
        reported.push(error);
      },
      {
        objectId: "container-1",
        objectKind: "container",
        operation: "container.metadata.sync",
      },
    ),
  ).rejects.toBe(staleCitation);
  expect(reported).toEqual([]);
});
