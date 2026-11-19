import { expect, test } from "bun:test";
import type { AccessEvent } from "@tearleads/crypto";
import { createTestExecSql } from "@tearleads/test-utils";
import { createMultipartBlobStageFixture } from "../../../../test/helpers/data/blobUploadFixtures";
import { createBlobAttachmentServiceFixture } from "../../../../test/helpers/workflows/blobAttachmentServiceFixture";
import { createMaterializedSyncFixture } from "../../../../test/helpers/workflows/materializedSyncFixture";
import type { UploadDocumentAttachmentRequest } from "../../../data/blobs/attachments/types";
import type { BlobBytes } from "../../../data/blobs/blobContracts";
import { KeyingCheckpointRepository } from "../../../data/persistence/keyingCheckpoints/keyingCheckpointRepository";
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

test("an upload retired during projection loading leaves no verification checkpoint", async () => {
  const { author, resolveProjectionUserKey, secretKey, writerProjection } =
    await createMaterializedSyncFixture();
  const { close, execSql } = await createTestExecSql("retired-blob-projection");
  let current = true;
  try {
    const result = await createBlobAttachmentServiceFixture({
      api: {
        getDocumentWriterProjection: async () => {
          current = false;
          return writerProjection;
        },
      },
      encapsulationSecretKey: secretKey,
      execSql,
    })
      .uploadDocumentAttachment({
        author,
        bytes: new Uint8Array([1]),
        documentId: writerProjection.documentId,
        expectedBindingId: null,
        resolveProjectionUserKey,
        slotId: "avatar",
        stillCurrent: () => current,
        isRemoteSyncBlocked: () => !current,
      })
      .catch(() => null);
    expect(result).toBeNull();
    expect(
      await new KeyingCheckpointRepository(
        execSql,
      ).loadAccessManifestCheckpoint(
        "document",
        author.organizationId,
        writerProjection.documentId,
      ),
    ).toBeNull();
  } finally {
    close();
  }
});
