import { expect, test } from "bun:test";
import { MULTIPART_BLOB_STAGE_ERROR_CODES } from "@tearleads/validators/response";
import type { BlobEncryptionPlan } from "../../data/documents/blob/shared/crypto";
import type { BlobAttachmentApi } from "../../data/documents/blob/shared/types";
import { stageMultipartBlobAttachment } from "./multipartUpload";

const CHUNK_SIZE = 5 * 1024 * 1024;

type RequestFailure = NonNullable<
  ReturnType<NonNullable<BlobAttachmentApi["getRequestFailure"]>>
>;

function createPlan(onEncrypt: () => void = () => {}): BlobEncryptionPlan {
  return {
    byteLength: 1,
    chunkSize: CHUNK_SIZE,
    encryptPart: async () => {
      onEncrypt();
      return new Uint8Array([1]);
    },
    getPartByteLength: () => 1,
    metadataHash: "metadata-hash",
    partCount: 1,
    plaintextByteLength: 1,
    plaintextSha256: "plaintext-sha256",
    sha256: "encrypted-sha256",
  };
}

function createApi(input: {
  readonly failure: RequestFailure;
  readonly onInitiate: () => void;
}): BlobAttachmentApi {
  return {
    bindBlobAttachment: async () => null,
    completeMultipartBlobStage: async (stageId) => ({
      byteLength: 1,
      expiresAt: "2026-04-27T01:00:00.000Z",
      sha256: "encrypted-sha256",
      stageId,
    }),
    getDocumentWriterProjection: async () => null,
    getMultipartBlobStage: async () => null,
    getRequestFailure: () => input.failure,
    initiateMultipartBlobStage: async (request) => {
      input.onInitiate();
      return {
        ...request,
        expiresAt: "2026-04-27T01:00:00.000Z",
        stageId: "stage-fresh",
        uploadedParts: [],
        uploadId: "upload-fresh",
      };
    },
    uploadMultipartBlobPartBytes: async (stageId, partNumber, request) => ({
      part: { byteLength: 1, etag: "etag-1", partNumber },
      stageId,
      uploadId: request.uploadId,
    }),
  };
}

test("opens a fresh stage only after coded absence or expiry", async () => {
  const failures = [
    {
      code: MULTIPART_BLOB_STAGE_ERROR_CODES.notFound,
      kind: "http",
      message: "404 Not Found",
      status: 404,
    },
    {
      code: MULTIPART_BLOB_STAGE_ERROR_CODES.expired,
      kind: "http",
      message: "409 Conflict",
      status: 409,
    },
  ] as const;

  for (const failure of failures) {
    let initiateCalls = 0;
    const stageId = await stageMultipartBlobAttachment({
      apiClient: createApi({
        failure,
        onInitiate: () => {
          initiateCalls += 1;
        },
      }),
      encryption: createPlan(),
      multipart: { partSize: CHUNK_SIZE, resumeStageId: "stage-gone" },
    });

    expect(stageId).toBe("stage-fresh");
    expect(initiateCalls).toBe(1);
  }
});

test("preserves resumable state after unproven lookup failures", async () => {
  const failures: readonly RequestFailure[] = [
    { kind: "network", message: "fetch failed", status: null },
    { kind: "http", message: "503 Service Unavailable", status: 503 },
    { kind: "shape", message: "Invalid response shape", status: 200 },
    { kind: "http", message: "404 Not Found", status: 404 },
    { kind: "http", message: "409 Conflict", status: 409 },
    {
      code: MULTIPART_BLOB_STAGE_ERROR_CODES.expired,
      kind: "http",
      message: "wrong status for expired code",
      status: 404,
    },
    {
      code: MULTIPART_BLOB_STAGE_ERROR_CODES.notFound,
      kind: "http",
      message: "wrong status for missing code",
      status: 409,
    },
    {
      code: "unknown_code",
      kind: "http",
      message: "unknown code",
      status: 404,
    },
  ];

  for (const failure of failures) {
    let encryptCalls = 0;
    let initiateCalls = 0;
    let resolvedCalls = 0;
    let unavailableCalls = 0;
    await expect(
      stageMultipartBlobAttachment({
        apiClient: createApi({
          failure,
          onInitiate: () => {
            initiateCalls += 1;
          },
        }),
        encryption: createPlan(() => {
          encryptCalls += 1;
        }),
        multipart: { partSize: CHUNK_SIZE, resumeStageId: "stage-preserved" },
        onStageResolved: () => {
          resolvedCalls += 1;
        },
        onStageUnavailable: async () => {
          unavailableCalls += 1;
        },
      }),
    ).rejects.toThrow(failure.message);
    expect(encryptCalls).toBe(0);
    expect(initiateCalls).toBe(0);
    expect(resolvedCalls).toBe(0);
    expect(unavailableCalls).toBe(0);
  }
});

test("a durable owner renews its identity before a missing stage is replaced", async () => {
  let initiateCalls = 0;
  const unavailableStages: string[] = [];
  await expect(
    stageMultipartBlobAttachment({
      apiClient: createApi({
        failure: {
          code: MULTIPART_BLOB_STAGE_ERROR_CODES.notFound,
          kind: "http",
          message: "stage consumed by a committed bind",
          status: 404,
        },
        onInitiate: () => {
          initiateCalls += 1;
        },
      }),
      encryption: createPlan(),
      multipart: { partSize: CHUNK_SIZE, resumeStageId: "consumed-stage" },
      onStageUnavailable: async (stageId) => {
        unavailableStages.push(stageId);
      },
    }),
  ).rejects.toThrow("upload attempt stopped for recovery");
  expect(unavailableStages).toEqual(["consumed-stage"]);
  expect(initiateCalls).toBe(0);
});
