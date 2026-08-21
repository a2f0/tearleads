import { expect, test } from "bun:test";
import { createTestExecSql } from "@symcrypt/test-utils";
import {
  createBlobAttachmentBindResponse,
  createMultipartBlobStageFixture,
} from "../../../test/helpers/blobUploadFixtures";
import { createMaterializedSyncFixture } from "../../../test/helpers/documentFixtures";
import type { BlobBytes } from "../../data/blobContracts";
import { parseBlobEncryptedBytes } from "../../data/documents/blob/shared/readers";
import type { MultipartUploadProgress } from "../../data/documents/blob/shared/types";
import { uploadDocumentAttachment } from "./upload";

const DEFAULT_CHUNK_SIZE = 5 * 1024 * 1024;

test("uploadDocumentAttachment defaults every blob to 5 MiB multipart", async () => {
  const { author, resolveProjectionUserKey, secretKey, writerProjection } =
    await createMaterializedSyncFixture();
  const blobId = "550e8400-e29b-41d4-a716-446655440575";
  const bindingId = "550e8400-e29b-41d4-a716-446655440576";
  const slotId = "preview";
  const multipart = createMultipartBlobStageFixture({
    stageId: "stage-auto-multipart-upload",
    uploadId: "upload-auto-multipart-upload",
  });
  const { getAssembledBytes, ...multipartApi } = multipart;
  const uploadedPartNumbers: number[] = [];
  const progressEvents: MultipartUploadProgress[] = [];
  const { close, execSql } = await createTestExecSql("automatic-multipart");

  const uploaded = await uploadDocumentAttachment({
    apiClient: {
      ...multipartApi,
      bindBlobAttachment: async (requestBlobId, request) =>
        createBlobAttachmentBindResponse({
          blobId: requestBlobId,
          documentManifest: writerProjection.documentManifest,
          request,
        }),
      getDocumentWriterProjection: async () => writerProjection,
      uploadMultipartBlobPartBytes: async (stageId, partNumber, request) => {
        const response = await multipart.uploadMultipartBlobPartBytes(
          stageId,
          partNumber,
          request,
        );
        uploadedPartNumbers.push(partNumber);
        return response;
      },
    },
    author,
    bindingId,
    blobId,
    bytes: new Uint8Array(8 * 1024 * 1024) as BlobBytes,
    documentId: writerProjection.documentId,
    execSql,
    expectedBindingId: null,
    onMultipartProgress: (progress) => progressEvents.push(progress),
    resolveProjectionUserKey,
    signedAt: "2026-04-27T00:00:00.000Z",
    slotId,
    targetSecretKey: secretKey,
  });
  close();

  expect(uploaded?.request.stagedBlob?.stageId).toBe(
    "stage-auto-multipart-upload",
  );
  expect(uploadedPartNumbers.toSorted()).toEqual([1, 2]);
  const encryptedBytes = getAssembledBytes();
  if (!encryptedBytes) {
    throw new Error("Expected assembled binary blob bytes");
  }
  const encryptedRecord = parseBlobEncryptedBytes(encryptedBytes);
  expect(encryptedRecord).toMatchObject({
    blobId,
    byteLength: 8 * 1024 * 1024,
    chunkCount: 2,
    chunkSize: DEFAULT_CHUNK_SIZE,
  });

  expect(progressEvents.length).toBe(3);
  expect(progressEvents[0]).toEqual({
    bytesTotal: encryptedRecord.encryptedByteLength,
    bytesUploaded: 0,
    partsCompleted: 0,
    partsTotal: 2,
  });
  expect(progressEvents.at(-1)).toEqual({
    bytesTotal: encryptedRecord.encryptedByteLength,
    bytesUploaded: encryptedRecord.encryptedByteLength,
    partsCompleted: 2,
    partsTotal: 2,
  });
});
