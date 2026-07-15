import { expect, test } from "bun:test";
import type { AccessEvent } from "@tearleads/crypto";
import { createTestExecSql } from "@tearleads/test-utils";
import { createMaterializedSyncFixture } from "../../../test/helpers/documentFixtures";
import type { BlobBytes } from "../../data/blobContracts";
import { uploadDocumentAttachment } from "./upload";

test("uploadDocumentAttachment rejects document writer projections with bad signatures before staging", async () => {
  const { author, resolveProjectionUserKey, secretKey, writerProjection } =
    await createMaterializedSyncFixture();
  const tamperedProjection = structuredClone(writerProjection);
  const signedEvent = tamperedProjection.documentManifest.event
    .event as unknown as AccessEvent;
  const signature = signedEvent.signature;
  if (typeof signature !== "string" || signature.length === 0) {
    throw new Error("Expected signed document event fixture");
  }
  signedEvent.signature = `${signature.slice(0, -1)}${
    signature.endsWith("A") ? "B" : "A"
  }`;
  let stageCalled = false;
  let bindCalled = false;
  const { close, execSql } = await createTestExecSql("blob-signature-check");

  await expect(
    uploadDocumentAttachment({
      apiClient: {
        bindBlobAttachment: async () => {
          bindCalled = true;
          throw new Error("Unexpected bind");
        },
        getDocumentWriterProjection: async () => tamperedProjection,
        stageBlob: async () => {
          stageCalled = true;
          throw new Error("Unexpected stage");
        },
      },
      author,
      blobId: "550e8400-e29b-41d4-a716-446655440557",
      bytes: new Uint8Array([5, 6, 7]) as BlobBytes,
      documentId: writerProjection.documentId,
      execSql,
      expectedBindingId: null,
      resolveProjectionUserKey,
      signedAt: "2026-04-27T00:00:00.000Z",
      slotId: "preview",
      targetSecretKey: secretKey,
    }),
  ).rejects.toThrow("Document writer projection signature verification failed");
  close();
  expect(stageCalled).toBe(false);
  expect(bindCalled).toBe(false);
});

test("uploadDocumentAttachment cannot use local trust to bypass remote checkpoints", async () => {
  const { author, resolveProjectionUserKey, secretKey, writerProjection } =
    await createMaterializedSyncFixture();
  let stageCalled = false;
  const input = {
    apiClient: {
      bindBlobAttachment: async () => null,
      getDocumentWriterProjection: async () => writerProjection,
      stageBlob: async () => {
        stageCalled = true;
        return null;
      },
    },
    author,
    bytes: new Uint8Array([1, 2, 3]) as BlobBytes,
    documentId: writerProjection.documentId,
    expectedBindingId: null,
    resolveProjectionUserKey,
    slotId: "checkpoint-bypass",
    targetSecretKey: secretKey,
    trustedLocalProjection: true,
  } as unknown as Parameters<typeof uploadDocumentAttachment>[0];

  await expect(uploadDocumentAttachment(input)).rejects.toMatchObject({
    code: "missing_dependency",
  });
  expect(stageCalled).toBe(false);
});
