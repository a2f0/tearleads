import type { BlobEncryptionPlan } from "../../data/documents/blob/shared/crypto";
import type { BlobAttachmentApi } from "../../data/documents/blob/shared/types";

export const DEFAULT_CHUNK_SIZE = 5 * 1024 * 1024;

interface FakePlanOptions {
  readonly byteLength?: number;
  readonly encryptPart?: (
    partIndex: number,
    byteLength: number,
  ) => Promise<Uint8Array<ArrayBuffer>>;
  readonly getPartByteLength?: (partIndex: number) => number;
  readonly partCount: number;
}

export function createFakePlan(options: FakePlanOptions): BlobEncryptionPlan {
  const getPartByteLength = options.getPartByteLength ?? (() => 3);
  const byteLength =
    options.byteLength ??
    Array.from({ length: options.partCount }, (_, partIndex) =>
      getPartByteLength(partIndex),
    ).reduce((total, length) => total + length, 0);

  return {
    byteLength,
    chunkSize: DEFAULT_CHUNK_SIZE,
    encryptPart: async (partIndex) =>
      options.encryptPart
        ? options.encryptPart(partIndex, getPartByteLength(partIndex))
        : new Uint8Array(getPartByteLength(partIndex)).fill(partIndex + 1),
    getPartByteLength,
    metadataHash: "metadata-hash",
    partCount: options.partCount,
    plaintextByteLength: byteLength,
    plaintextSha256: "plaintext-sha256",
    sha256: "plan-sha256",
  };
}

export function createMultipartApi(
  overrides: Partial<BlobAttachmentApi> = {},
): BlobAttachmentApi {
  return {
    bindBlobAttachment: async () => null,
    completeMultipartBlobStage: async (stageId) => ({
      byteLength: 6,
      organizationId: "organization-1",
      expiresAt: "2026-04-27T01:00:00.000Z",
      sha256: "plan-sha256",
      stageId,
    }),
    getDocumentWriterProjection: async () => null,
    getMultipartBlobStage: async () => null,
    initiateMultipartBlobStage: async (request) => ({
      ...request,
      organizationId: "organization-1",
      expiresAt: "2026-04-27T01:00:00.000Z",
      stageId: "stage-new",
      uploadedParts: [],
      uploadId: "upload-new",
    }),
    uploadMultipartBlobPartBytes: async (stageId, partNumber, request) => ({
      part: {
        byteLength: request.byteLength,
        etag: `etag-${partNumber}`,
        partNumber,
      },
      stageId,
      uploadId: request.uploadId,
    }),
    ...overrides,
  };
}
