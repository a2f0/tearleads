import { expect, test } from "bun:test";
import { KeyingVerificationError } from "@tearleads/crypto";
import { DocumentSyncUpdateIsolationError } from "../documents/shared/documentSyncUpdateIsolation";
import {
  isStaleCitationError,
  isStaleCitationInCauseChain,
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

test("a stale ancestor citation is recorded and preserves the boundary", async () => {
  // A head by a member with no current authority that cites a stale ancestor
  // head is recorded like any refusal; the deferral is the sync boundary's.
  const staleCitation = new KeyingVerificationError(
    "stale_citation",
    "path[1] cites a stale head of ancestor container root",
  );
  const wrapped = new Error("metadata sync failed", { cause: staleCitation });
  const reported: unknown[] = [];

  expect(isStaleCitationError(staleCitation)).toBe(true);
  expect(isStaleCitationError(wrapped)).toBe(false);
  expect(isStaleCitationInCauseChain(wrapped)).toBe(true);
  await expect(
    reportAndRethrowKeyingVerificationError(
      wrapped,
      async (error) => {
        reported.push(error);
      },
      {
        objectId: "container-1",
        objectKind: "container",
        operation: "container.metadata.sync",
      },
    ),
  ).rejects.toBe(wrapped);
  expect(reported).toEqual([staleCitation]);
});
