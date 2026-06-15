import { expect, test } from "bun:test";
import type { BlobAttachmentApi } from "../../data/documents/blob/shared/types";
import { resolveMultipartUploadOptions } from "./automaticMultipartUpload";

function createAutomaticMultipartApi(
  getBlobUploadCapabilities: NonNullable<
    BlobAttachmentApi["getBlobUploadCapabilities"]
  >,
): BlobAttachmentApi {
  return {
    bindBlobAttachment: async () => null,
    completeMultipartBlobStage: async () => null,
    getBlobUploadCapabilities,
    getDocumentWriterProjection: async () => null,
    getMultipartBlobStage: async () => null,
    initiateMultipartBlobStage: async () => null,
    stageBlob: async () => null,
    uploadMultipartBlobPart: async () => null,
  };
}

test("automatic multipart falls back when capability discovery fails", async () => {
  await expect(
    resolveMultipartUploadOptions({
      apiClient: createAutomaticMultipartApi(async () => {
        throw new Error("Capability discovery unavailable");
      }),
      encryptedByteLength: 8 * 1024 * 1024,
      multipart: undefined,
    }),
  ).resolves.toBeUndefined();
});

test("automatic multipart falls back without durable capabilities", async () => {
  await expect(
    resolveMultipartUploadOptions({
      apiClient: createAutomaticMultipartApi(async () => null),
      encryptedByteLength: 8 * 1024 * 1024,
      multipart: undefined,
    }),
  ).resolves.toBeUndefined();
});
