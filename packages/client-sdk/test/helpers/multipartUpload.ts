import type { InitiateMultipartBlobStageRequest } from "@tearleads/validators/request";
import type { InitiateMultipartBlobStageResponse } from "@tearleads/validators/response";
import type { BlobEncryptionPlan } from "../../src/data/blobs/attachments/crypto";
import type { BlobAttachmentApi } from "../../src/data/blobs/attachments/types";

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

/**
 * What the API answers for a stage initiation with a non-signing store: the
 * declared stage plus an API upload source for each described first part.
 */
export function initiatedStage(
  request: InitiateMultipartBlobStageRequest,
  stage: {
    readonly organizationId?: string;
    readonly stageId: string;
    readonly uploadId: string;
  },
): InitiateMultipartBlobStageResponse {
  const { firstParts, ...declared } = request;
  return {
    ...declared,
    organizationId: stage.organizationId ?? "organization-1",
    expiresAt: "2026-04-27T01:00:00.000Z",
    partUploads: firstParts.map((part) => ({
      ...part,
      source: { kind: "api" as const },
    })),
    stageId: stage.stageId,
    uploadedParts: [],
    uploadId: stage.uploadId,
  };
}

export function createMultipartApi(
  overrides: Partial<BlobAttachmentApi> = {},
): BlobAttachmentApi {
  return {
    bindBlobAttachment: async () => null,
    getDocumentWriterProjection: async () => null,
    getMultipartBlobStage: async () => null,
    initiateMultipartBlobStage: async (request) =>
      initiatedStage(request, { stageId: "stage-new", uploadId: "upload-new" }),
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
