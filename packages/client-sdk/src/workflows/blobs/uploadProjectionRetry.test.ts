import { expect, test } from "bun:test";
import { KeyingVerificationError } from "@tearleads/crypto";
import { createTestExecSql } from "@tearleads/test-utils";
import {
  createBlobAttachmentBindResponse,
  createMultipartBlobStageFixture,
} from "../../../test/helpers/blobUploadFixtures";
import { createMaterializedSyncFixture } from "../../../test/helpers/documentFixtures";
import type { BlobBytes } from "../../data/blobContracts";
import { uploadDocumentAttachment } from "./upload";

test("uploadDocumentAttachment refetches writer projection after a stale container KEK unwrap", async () => {
  const { author, resolveProjectionUserKey, secretKey, writerProjection } =
    await createMaterializedSyncFixture();
  const validSecretKey = secretKey.slice();
  crypto.getRandomValues(secretKey);
  const blobId = "550e8400-e29b-41d4-a716-446655440565";
  const bindingId = "550e8400-e29b-41d4-a716-446655440566";
  const slotId = "preview";
  const evictedDocumentIds: string[] = [];
  let projectionRequestCount = 0;
  let stageCount = 0;
  let completionCount = 0;
  const multipart = createMultipartBlobStageFixture({
    stageId: "stage-stale-blob-upload",
  });
  const { close, execSql } = await createTestExecSql("blob-projection-retry");

  const uploaded = await uploadDocumentAttachment({
    apiClient: {
      ...multipart,
      bindBlobAttachment: async (requestBlobId, request) =>
        createBlobAttachmentBindResponse({
          blobId: requestBlobId,
          documentManifest: writerProjection.documentManifest,
          request,
        }),
      completeMultipartBlobStage: async (stageId, request) => {
        completionCount += 1;
        return multipart.completeMultipartBlobStage(stageId, request);
      },
      evictDocumentWriterProjection: (documentId) => {
        evictedDocumentIds.push(documentId);
        secretKey.set(validSecretKey);
      },
      getDocumentWriterProjection: async (documentId) => {
        if (documentId !== writerProjection.documentId) {
          return null;
        }

        projectionRequestCount += 1;
        return writerProjection;
      },
      initiateMultipartBlobStage: async (request) => {
        stageCount += 1;
        return multipart.initiateMultipartBlobStage(request);
      },
    },
    author,
    bindingId,
    blobId,
    bytes: new Uint8Array([1, 2, 3, 4]) as BlobBytes,
    documentId: writerProjection.documentId,
    execSql,
    expectedBindingId: null,
    resolveProjectionUserKey,
    slotId,
    targetSecretKey: secretKey,
  });
  close();

  expect(uploaded?.writerProjection).toBe(writerProjection);
  expect(evictedDocumentIds).toEqual([writerProjection.documentId]);
  expect(projectionRequestCount).toBe(2);
  expect(stageCount).toBe(1);
  expect(completionCount).toBe(1);
  expect(uploaded?.bindingId).toBe(bindingId);
});

test("uploadDocumentAttachment does not retry identity failures that resemble stale unwraps", async () => {
  const { author, secretKey, writerProjection } =
    await createMaterializedSyncFixture();
  const integrityError = new KeyingVerificationError(
    "object_mismatch",
    "Container writer projection KEK identity could not be unwrapped",
  );
  const { close, execSql } = await createTestExecSql(
    "blob-projection-identity-failure",
  );
  let evictions = 0;
  let projectionRequests = 0;
  let stageRequests = 0;
  const multipart = createMultipartBlobStageFixture();

  try {
    await expect(
      uploadDocumentAttachment({
        apiClient: {
          ...multipart,
          bindBlobAttachment: async () => null,
          evictDocumentWriterProjection: () => {
            evictions += 1;
          },
          getDocumentWriterProjection: async () => {
            projectionRequests += 1;
            return writerProjection;
          },
          initiateMultipartBlobStage: async (request) => {
            stageRequests += 1;
            return multipart.initiateMultipartBlobStage(request);
          },
        },
        author,
        bytes: new Uint8Array([1, 2, 3]) as BlobBytes,
        documentId: writerProjection.documentId,
        execSql,
        expectedBindingId: null,
        resolveProjectionUserKey: async () => {
          throw integrityError;
        },
        slotId: "identity-failure",
        targetSecretKey: secretKey,
      }),
    ).rejects.toBe(integrityError);
    expect(evictions).toBe(0);
    expect(projectionRequests).toBe(1);
    expect(stageRequests).toBe(0);
  } finally {
    close();
  }
});
