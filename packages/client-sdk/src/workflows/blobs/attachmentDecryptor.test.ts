import { expect, test } from "bun:test";
import { KeyingVerificationError } from "@tearleads/crypto";
import type { DocumentWriterProjectionResponse } from "@tearleads/validators/response";
import { ProjectionDependencyUnavailableError } from "../../data/keyingProjectionVerification/dependencyUnavailable";
import { createAttachmentProofReader } from "./attachmentDecryptor";

// The reader only forwards projections, so opaque stand-ins are enough.
const stale = { documentId: "stale" } as DocumentWriterProjectionResponse;
const fresh = { documentId: "fresh" } as DocumentWriterProjectionResponse;

function createReader(readError: () => Error) {
  const calls = { evicted: 0, fetched: 0 };
  const read = createAttachmentProofReader(
    {
      evictDocumentWriterProjection: () => {
        calls.evicted += 1;
      },
      getDocumentWriterProjection: async () => {
        calls.fetched += 1;
        return fresh;
      },
    },
    "document",
    async (input: { writerProjection: DocumentWriterProjectionResponse }) => {
      if (input.writerProjection === stale) throw readError();
      return input.writerProjection;
    },
  );
  return { calls, read };
}

test("a wrap-cited manifest missing from the projection refreshes it once", async () => {
  const { calls, read } = createReader(
    () =>
      new ProjectionDependencyUnavailableError(
        "Blob wrapped-target manifest is unavailable",
      ),
  );
  expect(await read({ writerProjection: stale })).toBe(fresh);
  expect(calls).toEqual({ evicted: 1, fetched: 1 });
});

test("a missing keying dependency refreshes the projection once", async () => {
  const { calls, read } = createReader(
    () => new KeyingVerificationError("missing_dependency", "missing"),
  );
  expect(await read({ writerProjection: stale })).toBe(fresh);
  expect(calls).toEqual({ evicted: 1, fetched: 1 });
});

test("integrity failures never refresh the projection", async () => {
  const { calls, read } = createReader(
    () => new KeyingVerificationError("object_mismatch", "tampered"),
  );
  await expect(read({ writerProjection: stale })).rejects.toMatchObject({
    code: "object_mismatch",
  });
  expect(calls).toEqual({ evicted: 0, fetched: 0 });
});
