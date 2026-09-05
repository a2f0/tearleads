import { describe, expect, test } from "bun:test";
import type { BlobEncryptionPlan } from "../../data/documents/blob/shared/crypto";
import type { BlobAttachmentApi } from "../../data/documents/blob/shared/types";
import { stageMultipartBlobAttachment } from "./multipartUpload";

const CHUNK_SIZE = 5 * 1024 * 1024;

function createPlan(
  encryptPart: BlobEncryptionPlan["encryptPart"] = async () =>
    new Uint8Array([1]),
): BlobEncryptionPlan {
  return {
    byteLength: 1,
    chunkSize: CHUNK_SIZE,
    encryptPart,
    getPartByteLength: () => 1,
    metadataHash: "metadata-hash",
    partCount: 1,
    plaintextByteLength: 1,
    plaintextSha256: "plaintext-sha256",
    sha256: "encrypted-sha256",
  };
}

function createApi(
  overrides: Partial<BlobAttachmentApi> = {},
): BlobAttachmentApi {
  return {
    bindBlobAttachment: async () => null,
    completeMultipartBlobStage: async (stageId) => ({
      byteLength: 1,
      organizationId: "organization-1",
      expiresAt: "2026-04-27T01:00:00.000Z",
      sha256: "encrypted-sha256",
      stageId,
    }),
    getDocumentWriterProjection: async () => null,
    getMultipartBlobStage: async () => null,
    initiateMultipartBlobStage: async (request) => ({
      ...request,
      organizationId: "organization-1",
      expiresAt: "2026-04-27T01:00:00.000Z",
      stageId: "stage-1",
      uploadedParts: [],
      uploadId: "upload-1",
    }),
    uploadMultipartBlobPartBytes: async (stageId, partNumber, request) => ({
      part: {
        byteLength: request.byteLength,
        etag: "etag-1",
        partNumber,
      },
      stageId,
      uploadId: request.uploadId,
    }),
    ...overrides,
  };
}

const multipart = { partSize: CHUNK_SIZE } as const;

describe("multipart response identity", () => {
  test("rejects a part size that differs from the encryption layout", async () => {
    await expect(
      stageMultipartBlobAttachment({
        organizationId: "organization-1",
        apiClient: createApi(),
        encryption: createPlan(),
        multipart: { partSize: CHUNK_SIZE + 1 },
      }),
    ).rejects.toThrow(
      "Multipart part size must match the encryption chunk size exactly.",
    );
  });

  test("rejects initiation responses for a different organization or bytes", async () => {
    for (const mismatch of [
      "organizationId",
      "byteLength",
      "sha256",
    ] as const) {
      let encryptCalls = 0;
      await expect(
        stageMultipartBlobAttachment({
          organizationId: "organization-1",
          apiClient: createApi({
            initiateMultipartBlobStage: async (request) => ({
              ...request,
              byteLength:
                mismatch === "byteLength"
                  ? request.byteLength + 1
                  : request.byteLength,
              organizationId:
                mismatch === "organizationId"
                  ? "organization-2"
                  : "organization-1",
              expiresAt: "2026-04-27T01:00:00.000Z",
              sha256:
                mismatch === "sha256" ? "different-sha256" : request.sha256,
              stageId: "stage-1",
              uploadedParts: [],
              uploadId: "upload-1",
            }),
          }),
          encryption: createPlan(async () => {
            encryptCalls += 1;
            return new Uint8Array([1]);
          }),
          multipart,
        }),
      ).rejects.toThrow(
        "Multipart blob stage initiation response does not match its request.",
      );
      expect(encryptCalls).toBe(0);
    }
  });

  test("rejects a resume response for a different stage", async () => {
    await expect(
      stageMultipartBlobAttachment({
        organizationId: "organization-1",
        apiClient: createApi({
          getMultipartBlobStage: async () => ({
            byteLength: 1,
            completed: false,
            organizationId: "organization-1",
            expiresAt: "2026-04-27T01:00:00.000Z",
            sha256: "encrypted-sha256",
            stageId: "stage-wrong",
            uploadedParts: [],
            uploadId: "upload-1",
          }),
        }),
        encryption: createPlan(),
        multipart: { ...multipart, resumeStageId: "stage-resume" },
      }),
    ).rejects.toThrow(
      "Multipart blob resume response does not match stage stage-resume.",
    );
  });

  test("rejects part responses for a different upload task", async () => {
    for (const mismatch of [
      "stageId",
      "uploadId",
      "partNumber",
      "byteLength",
    ] as const) {
      await expect(
        stageMultipartBlobAttachment({
          organizationId: "organization-1",
          apiClient: createApi({
            uploadMultipartBlobPartBytes: async (
              stageId,
              partNumber,
              request,
            ) => ({
              part: {
                byteLength:
                  mismatch === "byteLength"
                    ? request.byteLength + 1
                    : request.byteLength,
                etag: "etag-1",
                partNumber:
                  mismatch === "partNumber" ? partNumber + 1 : partNumber,
              },
              stageId: mismatch === "stageId" ? "stage-wrong" : stageId,
              uploadId:
                mismatch === "uploadId" ? "upload-wrong" : request.uploadId,
            }),
          }),
          encryption: createPlan(),
          multipart,
        }),
      ).rejects.toThrow(
        "Multipart blob part 1 response does not match its request.",
      );
    }
  });

  test("rejects completion responses for a different object", async () => {
    for (const mismatch of [
      "organizationId",
      "stageId",
      "byteLength",
      "sha256",
    ] as const) {
      await expect(
        stageMultipartBlobAttachment({
          organizationId: "organization-1",
          apiClient: createApi({
            completeMultipartBlobStage: async (stageId) => ({
              byteLength: mismatch === "byteLength" ? 2 : 1,
              organizationId:
                mismatch === "organizationId"
                  ? "organization-2"
                  : "organization-1",
              expiresAt: "2026-04-27T01:00:00.000Z",
              sha256:
                mismatch === "sha256" ? "different-sha256" : "encrypted-sha256",
              stageId: mismatch === "stageId" ? "stage-wrong" : stageId,
            }),
          }),
          encryption: createPlan(),
          multipart,
        }),
      ).rejects.toThrow(
        "Multipart blob stage stage-1 completion response does not match its request.",
      );
    }
  });
});

test("refuses to resume matching bytes staged in another organization", async () => {
  let initiated = false;
  let encrypted = false;
  await expect(
    stageMultipartBlobAttachment({
      organizationId: "organization-1",
      apiClient: createApi({
        initiateMultipartBlobStage: async () => {
          initiated = true;
          return null;
        },
        getMultipartBlobStage: async () => ({
          organizationId: "organization-2",
          byteLength: 1,
          completed: true,
          sha256: "encrypted-sha256",
          stageId: "stage-resume",
          uploadedParts: [],
          uploadId: "upload-1",
          expiresAt: "2026-04-27T01:00:00.000Z",
        }),
      }),
      encryption: createPlan(async () => {
        encrypted = true;
        return new Uint8Array([1]);
      }),
      multipart: { ...multipart, resumeStageId: "stage-resume" },
    }),
  ).rejects.toThrow("does not match the requested organization or bytes");
  expect(initiated).toBe(false);
  expect(encrypted).toBe(false);
});
