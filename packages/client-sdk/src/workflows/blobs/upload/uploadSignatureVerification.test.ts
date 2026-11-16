import { expect, test } from "bun:test";
import type { AccessEvent } from "@tearleads/crypto";
import { createTestExecSql } from "@tearleads/test-utils";
import { createBlobAttachmentServiceFixture } from "../../../../test/helpers/blobAttachmentServiceFixture";
import { createMultipartBlobStageFixture } from "../../../../test/helpers/blobUploadFixtures";
import { createMaterializedSyncFixture } from "../../../../test/helpers/documentFixtures";
import type { UploadDocumentAttachmentRequest } from "../../../data/blobs/attachments/types";
import type { BlobBytes } from "../../../data/blobs/blobContracts";
import type { ExecSql } from "../../../data/sqlite/sqlSchema";

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
  const multipart = createMultipartBlobStageFixture();
  const { close, execSql } = await createTestExecSql("blob-signature-check");

  await expect(
    createBlobAttachmentServiceFixture({
      api: {
        ...multipart,
        bindBlobAttachment: async () => {
          bindCalled = true;
          throw new Error("Unexpected bind");
        },
        getDocumentWriterProjection: async () => tamperedProjection,
        initiateMultipartBlobStage: async (request) => {
          stageCalled = true;
          return multipart.initiateMultipartBlobStage(request);
        },
      },
      encapsulationSecretKey: secretKey,
      execSql,
    }).uploadDocumentAttachment({
      author,
      blobId: "550e8400-e29b-41d4-a716-446655440557",
      bytes: new Uint8Array([5, 6, 7]) as BlobBytes,
      documentId: writerProjection.documentId,
      expectedBindingId: null,
      resolveProjectionUserKey,
      signedAt: "2026-04-27T00:00:00.000Z",
      slotId: "preview",
    }),
  ).rejects.toMatchObject({ code: "signature_mismatch" });
  close();
  expect(stageCalled).toBe(false);
  expect(bindCalled).toBe(false);
});

test("uploadDocumentAttachment cannot use local trust to bypass remote checkpoints", async () => {
  const { author, resolveProjectionUserKey, secretKey, writerProjection } =
    await createMaterializedSyncFixture();
  let stageCalled = false;
  const multipart = createMultipartBlobStageFixture();
  const blobs = createBlobAttachmentServiceFixture({
    api: {
      ...multipart,
      bindBlobAttachment: async () => null,
      getDocumentWriterProjection: async () => writerProjection,
      initiateMultipartBlobStage: async (
        request: Parameters<typeof multipart.initiateMultipartBlobStage>[0],
      ) => {
        stageCalled = true;
        return multipart.initiateMultipartBlobStage(request);
      },
    },
    encapsulationSecretKey: secretKey,
    // No durable checkpoint storage: local trust must not stand in for it.
    execSql: undefined as unknown as ExecSql,
  });
  const input = {
    author,
    bytes: new Uint8Array([1, 2, 3]) as BlobBytes,
    documentId: writerProjection.documentId,
    expectedBindingId: null,
    resolveProjectionUserKey,
    slotId: "checkpoint-bypass",
    trustedLocalProjection: true,
  } as unknown as UploadDocumentAttachmentRequest;

  await expect(blobs.uploadDocumentAttachment(input)).rejects.toMatchObject({
    code: "missing_dependency",
  });
  expect(stageCalled).toBe(false);
});
