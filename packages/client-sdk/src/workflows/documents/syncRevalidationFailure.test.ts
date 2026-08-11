import { expect, test } from "bun:test";
import { createTestExecSql } from "@tearleads/test-utils";
import { DOCUMENT_PROJECTION_ERROR_CODES } from "@tearleads/validators/response";
import { createMaterializedSyncFixture } from "../../../test/helpers/documentFixtures";
import { syncRemoteDocument } from "./sync";
import { describeDocumentRevalidationFailure } from "./syncFailureClassification";

// Edge-case row 13: a read-only pass whose writer-projection read is refused
// (a coded 409 from the projection route) used to fail silently — one burned
// request and a trace line, nothing durable, so the document never
// revalidated and nothing explained why.
test("a read-only pass reports a refused projection read durably", async () => {
  const { author, resolveProjectionUserKey, secretKey, writerProjection } =
    await createMaterializedSyncFixture();
  const { close, execSql } = await createTestExecSql(
    "read-only-projection-409",
  );
  const recorded: { message: string; status: number | null }[] = [];

  try {
    const synced = await syncRemoteDocument({
      apiClient: {
        getDocumentWriterProjection: async () => {
          throw new Error("Expected the Result variant to be used");
        },
        getDocumentWriterProjectionResult: async () => ({
          code: DOCUMENT_PROJECTION_ERROR_CODES.containerUnavailable,
          message: "Container for this document is unavailable",
          ok: false as const,
          report: () => undefined,
          status: 409,
        }),
        syncDocument: async () => {
          throw new Error("Sync must not run without a projection");
        },
      },
      author,
      documentId: writerProjection.documentId,
      execSql,
      localVersionVector: null,
      onReadOnlyProjectionFailure: (failure) => {
        recorded.push({ message: failure.message, status: failure.status });
      },
      pendingUpdates: [],
      resolveProjectionUserKey,
      resolveWriterPublicKey: async () => null,
      targetSecretKey: secretKey,
    });

    expect(synced).toBeNull();
    expect(recorded).toEqual([
      {
        message: "Container for this document is unavailable",
        status: 409,
      },
    ]);
  } finally {
    close();
  }
});

// The write-bearing handler stays the submit handler: a queued write is what
// that failure blocks, and its message vocabulary says so.
test("a write-bearing pass does not use the read-only handler", async () => {
  const { author, resolveProjectionUserKey, secretKey, writerProjection } =
    await createMaterializedSyncFixture();
  const { close, execSql } = await createTestExecSql(
    "write-bearing-projection-409",
  );
  const readOnlyRecorded: number[] = [];
  const submitRecorded: number[] = [];

  try {
    const synced = await syncRemoteDocument({
      apiClient: {
        getDocumentWriterProjection: async () => {
          throw new Error("Expected the Result variant to be used");
        },
        getDocumentWriterProjectionResult: async () => ({
          code: DOCUMENT_PROJECTION_ERROR_CODES.containerConflict,
          message: "Container keying conflicts with the document",
          ok: false as const,
          report: () => undefined,
          status: 409,
        }),
        syncDocument: async () => {
          throw new Error("Sync must not run without a projection");
        },
      },
      author,
      documentId: writerProjection.documentId,
      execSql,
      localVersionVector: null,
      onReadOnlyProjectionFailure: (failure) => {
        readOnlyRecorded.push(failure.status ?? -1);
      },
      onTerminalSubmitFailure: (failure) => {
        submitRecorded.push(failure.status ?? -1);
      },
      pendingUpdates: [
        {
          id: crypto.randomUUID(),
          partialEndVersionVector: "end",
          partialStartVersionVector: "start",
          sourceVersionVector: null,
          updateData: "queued",
        },
      ],
      resolveProjectionUserKey,
      resolveWriterPublicKey: async () => null,
      targetSecretKey: secretKey,
    });

    expect(synced).toBeNull();
    expect(readOnlyRecorded).toEqual([]);
    expect(submitRecorded).toEqual([409]);
  } finally {
    close();
  }
});

test("describeDocumentRevalidationFailure names the refusal", () => {
  expect(
    describeDocumentRevalidationFailure({
      message: "Container for this document is unavailable",
      status: 409,
    }),
  ).toBe(
    "Remote revalidation failed: Container for this document is unavailable (409)",
  );
  expect(
    describeDocumentRevalidationFailure({ message: "  ", status: null }),
  ).toBe("Remote revalidation failed: the server refused the read");
});
