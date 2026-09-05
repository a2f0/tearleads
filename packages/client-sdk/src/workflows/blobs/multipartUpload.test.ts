import { describe, expect, test } from "bun:test";
import type { BlobEncryptionPlan } from "../../data/documents/blob/shared/crypto";
import type { BlobAttachmentApi } from "../../data/documents/blob/shared/types";
import { stageMultipartBlobAttachment } from "./multipartUpload";

const DEFAULT_CHUNK_SIZE = 5 * 1024 * 1024;

interface FakePlanOptions {
  readonly byteLength?: number;
  readonly encryptPart?: (
    partIndex: number,
    byteLength: number,
  ) => Promise<Uint8Array<ArrayBuffer>>;
  readonly getPartByteLength?: (partIndex: number) => number;
  readonly partCount: number;
}

function createFakePlan(options: FakePlanOptions): BlobEncryptionPlan {
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

function createMultipartApi(
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

describe("stageMultipartBlobAttachment", () => {
  test("encrypts parts lazily with bounded concurrency", async () => {
    const partLengths = [3, 4, 5, 6];
    const encryptedPartIndices: number[] = [];
    const uploadedPartNumbers: number[] = [];
    let activeEncryptions = 0;
    let maxActiveEncryptions = 0;
    const encryption = createFakePlan({
      getPartByteLength: (partIndex) => partLengths[partIndex] ?? 0,
      partCount: partLengths.length,
      encryptPart: async (partIndex, byteLength) => {
        encryptedPartIndices.push(partIndex);
        activeEncryptions += 1;
        maxActiveEncryptions = Math.max(
          maxActiveEncryptions,
          activeEncryptions,
        );
        await new Promise((resolve) => setTimeout(resolve, 0));
        activeEncryptions -= 1;
        return new Uint8Array(byteLength).fill(partIndex + 1);
      },
    });

    await stageMultipartBlobAttachment({
      organizationId: "organization-1",
      apiClient: createMultipartApi({
        completeMultipartBlobStage: async (stageId) => ({
          byteLength: encryption.byteLength,
          organizationId: "organization-1",
          expiresAt: "2026-04-27T01:00:00.000Z",
          sha256: encryption.sha256,
          stageId,
        }),
        initiateMultipartBlobStage: async (request) => {
          expect(encryptedPartIndices).toEqual([]);
          return {
            ...request,
            organizationId: "organization-1",
            expiresAt: "2026-04-27T01:00:00.000Z",
            stageId: "stage-lazy",
            uploadedParts: [],
            uploadId: "upload-lazy",
          };
        },
        uploadMultipartBlobPartBytes: async (stageId, partNumber, request) => {
          uploadedPartNumbers.push(partNumber);
          expect(request.sha256).toMatch(/^[0-9a-f]{64}$/);
          expect(request.byteLength).toBe(partLengths[partNumber - 1] ?? 0);
          return {
            part: {
              byteLength: request.byteLength,
              etag: `etag-${partNumber}`,
              partNumber,
            },
            stageId,
            uploadId: request.uploadId,
          };
        },
      }),
      encryption,
      multipart: { partSize: DEFAULT_CHUNK_SIZE, uploadConcurrency: 2 },
    });

    expect(encryptedPartIndices).toEqual([0, 1, 2, 3]);
    expect(uploadedPartNumbers).toEqual([1, 2, 3, 4]);
    expect(maxActiveEncryptions).toBe(2);
  });

  test("surfaces the failed binary multipart part number", async () => {
    await expect(
      stageMultipartBlobAttachment({
        organizationId: "organization-1",
        apiClient: createMultipartApi({
          uploadMultipartBlobPartBytes: async (stageId, partNumber, request) =>
            partNumber === 1
              ? {
                  part: {
                    byteLength: request.byteLength,
                    etag: "etag-1",
                    partNumber,
                  },
                  stageId,
                  uploadId: request.uploadId,
                }
              : null,
        }),
        encryption: createFakePlan({ partCount: 2 }),
        multipart: { partSize: DEFAULT_CHUNK_SIZE },
      }),
    ).rejects.toThrow("part 2 upload failed for stage stage-new");
  });

  test("drains active sibling uploads before surfacing the first failure", async () => {
    let releaseFirstPart: (() => void) | undefined;
    const firstPartBlocked = new Promise<void>((resolve) => {
      releaseFirstPart = resolve;
    });
    let observeSecondPartFailure: (() => void) | undefined;
    const secondPartFailed = new Promise<void>((resolve) => {
      observeSecondPartFailure = resolve;
    });
    const uploadedPartNumbers: number[] = [];
    const progressParts: number[] = [];
    let completed = false;

    const upload = stageMultipartBlobAttachment({
      organizationId: "organization-1",
      apiClient: createMultipartApi({
        completeMultipartBlobStage: async () => {
          completed = true;
          return null;
        },
        uploadMultipartBlobPartBytes: async (stageId, partNumber, request) => {
          uploadedPartNumbers.push(partNumber);
          if (partNumber === 2) {
            observeSecondPartFailure?.();
            throw new Error("part 2 network failure");
          }

          await firstPartBlocked;
          return {
            part: {
              byteLength: request.byteLength,
              etag: "etag-1",
              partNumber,
            },
            stageId,
            uploadId: request.uploadId,
          };
        },
      }),
      encryption: createFakePlan({ partCount: 4 }),
      multipart: { partSize: DEFAULT_CHUNK_SIZE, uploadConcurrency: 2 },
      onMultipartProgress: ({ partsCompleted }) => {
        progressParts.push(partsCompleted);
      },
    });
    let settled = false;
    void upload.then(
      () => {
        settled = true;
      },
      () => {
        settled = true;
      },
    );

    await secondPartFailed;
    await Promise.resolve();
    expect(uploadedPartNumbers).toEqual([1, 2]);
    expect(settled).toBe(false);

    releaseFirstPart?.();
    await expect(upload).rejects.toThrow("part 2 network failure");
    expect(uploadedPartNumbers).toEqual([1, 2]);
    expect(progressParts).toEqual([0, 1]);
    expect(completed).toBe(false);
  });

  test("resumes by part length without encrypting completed parts", async () => {
    const encryptedPartIndices: number[] = [];
    const uploadedPartNumbers: number[] = [];
    const resolvedStages: Array<{ partSize: number; stageId: string }> = [];
    const progress: Array<{
      bytesUploaded: number;
      partsCompleted: number;
    }> = [];
    const encryption = createFakePlan({
      encryptPart: async (partIndex, byteLength) => {
        encryptedPartIndices.push(partIndex);
        return new Uint8Array(byteLength);
      },
      partCount: 2,
    });

    const stageId = await stageMultipartBlobAttachment({
      organizationId: "organization-1",
      apiClient: createMultipartApi({
        getMultipartBlobStage: async (id) => ({
          byteLength: encryption.byteLength,
          completed: false,
          organizationId: "organization-1",
          expiresAt: "2026-04-27T01:00:00.000Z",
          sha256: encryption.sha256,
          stageId: id,
          uploadId: "upload-resume",
          uploadedParts: [{ byteLength: 3, etag: "etag-1", partNumber: 1 }],
        }),
        initiateMultipartBlobStage: async () => {
          throw new Error("Existing stage must not be replaced");
        },
        uploadMultipartBlobPartBytes: async (id, partNumber, request) => {
          uploadedPartNumbers.push(partNumber);
          return {
            part: {
              byteLength: request.byteLength,
              etag: `etag-${partNumber}`,
              partNumber,
            },
            stageId: id,
            uploadId: request.uploadId,
          };
        },
      }),
      encryption,
      multipart: {
        partSize: DEFAULT_CHUNK_SIZE,
        resumeStageId: "stage-resume",
      },
      onMultipartProgress: ({ bytesUploaded, partsCompleted }) => {
        progress.push({ bytesUploaded, partsCompleted });
      },
      onStageResolved: (input) => {
        resolvedStages.push(input);
      },
    });

    expect(stageId).toBe("stage-resume");
    expect(encryptedPartIndices).toEqual([1]);
    expect(uploadedPartNumbers).toEqual([2]);
    expect(progress).toEqual([
      { bytesUploaded: 3, partsCompleted: 1 },
      { bytesUploaded: 6, partsCompleted: 2 },
    ]);
    expect(resolvedStages).toEqual([
      { partSize: DEFAULT_CHUNK_SIZE, stageId: "stage-resume" },
    ]);
  });

  test("reports full progress without encryption for a completed stage", async () => {
    let encryptCalls = 0;
    const progress: Array<{
      bytesTotal: number;
      bytesUploaded: number;
      partsCompleted: number;
      partsTotal: number;
    }> = [];
    const encryption = createFakePlan({
      byteLength: 10,
      getPartByteLength: (partIndex) => [3, 3, 4][partIndex] ?? 0,
      encryptPart: async (_partIndex, byteLength) => {
        encryptCalls += 1;
        return new Uint8Array(byteLength);
      },
      partCount: 3,
    });
    await stageMultipartBlobAttachment({
      organizationId: "organization-1",
      apiClient: createMultipartApi({
        completeMultipartBlobStage: async () => {
          throw new Error("Completed stage must not be completed again");
        },
        getMultipartBlobStage: async (id) => ({
          byteLength: encryption.byteLength,
          completed: true,
          organizationId: "organization-1",
          expiresAt: "2026-04-27T01:00:00.000Z",
          sha256: encryption.sha256,
          stageId: id,
          uploadId: "upload-completed",
          uploadedParts: [],
        }),
        initiateMultipartBlobStage: async () => {
          throw new Error("Completed stage must not be replaced");
        },
      }),
      encryption,
      multipart: {
        partSize: DEFAULT_CHUNK_SIZE,
        resumeStageId: "stage-completed",
      },
      onMultipartProgress: (event) => progress.push(event),
    });

    expect(encryptCalls).toBe(0);
    expect(progress).toEqual([
      {
        bytesTotal: 10,
        bytesUploaded: 10,
        partsCompleted: 3,
        partsTotal: 3,
      },
    ]);
  });

  test("rejects a resumed stage metadata mismatch without replacing it", async () => {
    for (const mismatch of ["byteLength", "sha256"] as const) {
      let encryptCalls = 0;
      let initiateCalls = 0;
      let resolvedCalls = 0;
      const encryption = createFakePlan({
        encryptPart: async (_partIndex, byteLength) => {
          encryptCalls += 1;
          return new Uint8Array(byteLength);
        },
        partCount: 2,
      });
      await expect(
        stageMultipartBlobAttachment({
          organizationId: "organization-1",
          apiClient: createMultipartApi({
            getMultipartBlobStage: async (id) => ({
              byteLength:
                mismatch === "byteLength"
                  ? encryption.byteLength + 1
                  : encryption.byteLength,
              completed: false,
              organizationId: "organization-1",
              expiresAt: "2026-04-27T01:00:00.000Z",
              sha256:
                mismatch === "sha256" ? "stale-sha256" : encryption.sha256,
              stageId: id,
              uploadId: "upload-stale",
              uploadedParts: [{ byteLength: 3, etag: "etag-1", partNumber: 1 }],
            }),
            initiateMultipartBlobStage: async () => {
              initiateCalls += 1;
              return null;
            },
          }),
          encryption,
          multipart: {
            partSize: DEFAULT_CHUNK_SIZE,
            resumeStageId: "stage-stale",
          },
          onStageResolved: () => {
            resolvedCalls += 1;
          },
        }),
      ).rejects.toThrow(
        "Multipart blob resume stage stage-stale does not match the requested organization or bytes.",
      );

      expect(encryptCalls).toBe(0);
      expect(initiateCalls).toBe(0);
      expect(resolvedCalls).toBe(0);
    }
  });

  test("rejects plans above the object store limit before planning bytes", async () => {
    let plannedParts = 0;
    let initiated = false;
    await expect(
      stageMultipartBlobAttachment({
        organizationId: "organization-1",
        apiClient: createMultipartApi({
          initiateMultipartBlobStage: async () => {
            initiated = true;
            return null;
          },
        }),
        encryption: createFakePlan({
          byteLength: 10_001,
          getPartByteLength: () => {
            plannedParts += 1;
            return 1;
          },
          partCount: 10_001,
        }),
        multipart: { partSize: DEFAULT_CHUNK_SIZE },
      }),
    ).rejects.toThrow("maximum is 10,000 fixed 5 MiB chunks");
    expect(plannedParts).toBe(0);
    expect(initiated).toBe(false);
  });

  test("rejects an encrypted part that violates its planned length", async () => {
    let uploadCalls = 0;
    await expect(
      stageMultipartBlobAttachment({
        organizationId: "organization-1",
        apiClient: createMultipartApi({
          uploadMultipartBlobPartBytes: async () => {
            uploadCalls += 1;
            return null;
          },
        }),
        encryption: createFakePlan({
          encryptPart: async () => new Uint8Array(2),
          getPartByteLength: () => 3,
          partCount: 1,
        }),
        multipart: { partSize: DEFAULT_CHUNK_SIZE },
      }),
    ).rejects.toThrow(
      "Encrypted blob part 1 byte length mismatch: expected 3, received 2.",
    );
    expect(uploadCalls).toBe(0);
  });

  test("caps caller-configured upload concurrency", async () => {
    await expect(
      stageMultipartBlobAttachment({
        organizationId: "organization-1",
        apiClient: createMultipartApi(),
        encryption: createFakePlan({ partCount: 1 }),
        multipart: {
          partSize: DEFAULT_CHUNK_SIZE,
          uploadConcurrency: 5,
        },
      }),
    ).rejects.toThrow(
      "Multipart blob upload concurrency must be between 1 and 4",
    );
  });
});
