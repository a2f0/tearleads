import { describe, expect, test } from "bun:test";
import {
  splitEncryptedBytesIntoParts,
  stageMultipartBlobAttachment,
} from "./multipartUpload";

describe("splitEncryptedBytesIntoParts", () => {
  test("returns no parts for an empty payload", () => {
    expect(splitEncryptedBytesIntoParts("", 4)).toEqual([]);
  });

  test("rejects a non-positive or non-integer part size", () => {
    expect(() => splitEncryptedBytesIntoParts("abc", 0)).toThrow(
      "Multipart blob part size must be a positive integer",
    );
    expect(() => splitEncryptedBytesIntoParts("abc", -1)).toThrow(
      "Multipart blob part size must be a positive integer",
    );
    expect(() => splitEncryptedBytesIntoParts("abc", 1.5)).toThrow(
      "Multipart blob part size must be a positive integer",
    );
  });

  test("chunks an ASCII payload by part size", () => {
    expect(splitEncryptedBytesIntoParts("YWJjZGVmZw", 4)).toEqual([
      "YWJj",
      "ZGVm",
      "Zw",
    ]);
  });

  test("returns one part when the payload fits the budget", () => {
    expect(splitEncryptedBytesIntoParts("YWJj", 4)).toEqual(["YWJj"]);
    expect(splitEncryptedBytesIntoParts("YWJj", 16)).toEqual(["YWJj"]);
  });

  test("every part respects the byte budget and reconstructs the payload", () => {
    // A representative base64-shaped payload (the only kind this path ever sees).
    const payload = "QUJDREVGR0hJSktMTU5PUFFSU1RVVldYWVowMTIzNDU2Nzg5Ky89";
    for (const partSize of [1, 3, 5, 8, 16, 64]) {
      const parts = splitEncryptedBytesIntoParts(payload, partSize);
      expect(parts.join("")).toBe(payload);
      for (const part of parts) {
        expect(part.length).toBeLessThanOrEqual(partSize);
      }
    }
  });

  test("rejects a non-ASCII payload instead of carrying a UTF-8 splitter", () => {
    // Encrypted payloads are base64/hex canonical JSON and so always ASCII; a
    // non-ASCII payload is a contract violation that should fail loudly.
    expect(() => splitEncryptedBytesIntoParts("a€b", 4)).toThrow(
      "Multipart blob payload must be ASCII",
    );
    expect(() => splitEncryptedBytesIntoParts("😀", 8)).toThrow(
      "Multipart blob payload must be ASCII",
    );
  });
});

describe("stageMultipartBlobAttachment", () => {
  test("surfaces the failed multipart part number", async () => {
    await expect(
      stageMultipartBlobAttachment({
        apiClient: {
          bindBlobAttachment: async () => null,
          completeMultipartBlobStage: async () => null,
          getDocumentWriterProjection: async () => null,
          getMultipartBlobStage: async () => null,
          initiateMultipartBlobStage: async () => ({
            byteLength: 6,
            expiresAt: "2026-04-27T01:00:00.000Z",
            sha256: "sha256",
            stageId: "stage-failed-part",
            uploadedParts: [],
            uploadId: "upload-failed-part",
          }),
          stageBlob: async () => null,
          uploadMultipartBlobPart: async (_stageId, partNumber, input) =>
            partNumber === 1
              ? {
                  part: {
                    byteLength: input.encryptedBytes.length,
                    etag: "etag-1",
                    partNumber,
                  },
                  stageId: "stage-failed-part",
                  uploadId: input.uploadId,
                }
              : null,
        },
        byteLength: 6,
        encryptedBytes: "abcdef",
        multipart: { partSize: 3 },
        sha256: "sha256",
      }),
    ).rejects.toThrow(
      "Multipart blob part 2 upload failed for stage stage-failed-part.",
    );
  });

  test("resumes an existing stage and skips already-uploaded parts", async () => {
    const initiateCalls: number[] = [];
    const uploadedPartNumbers: number[] = [];
    const resolvedStages: Array<{ partSize: number; stageId: string }> = [];
    const stageId = await stageMultipartBlobAttachment({
      apiClient: {
        bindBlobAttachment: async () => null,
        completeMultipartBlobStage: async (id) => ({
          byteLength: 6,
          expiresAt: "2026-04-27T01:00:00.000Z",
          sha256: "sha256",
          stageId: id,
        }),
        getDocumentWriterProjection: async () => null,
        getMultipartBlobStage: async (id) => ({
          byteLength: 6,
          completed: false,
          expiresAt: "2026-04-27T01:00:00.000Z",
          sha256: "sha256",
          stageId: id,
          uploadId: "upload-resume",
          uploadedParts: [{ byteLength: 3, etag: "etag-1", partNumber: 1 }],
        }),
        initiateMultipartBlobStage: async () => {
          initiateCalls.push(1);
          return null;
        },
        stageBlob: async () => null,
        uploadMultipartBlobPart: async (id, partNumber, input) => {
          uploadedPartNumbers.push(partNumber);
          return {
            part: {
              byteLength: input.encryptedBytes.length,
              etag: `etag-${partNumber}`,
              partNumber,
            },
            stageId: id,
            uploadId: input.uploadId,
          };
        },
      },
      byteLength: 6,
      encryptedBytes: "abcdef",
      multipart: { partSize: 3, resumeStageId: "stage-resume" },
      onStageResolved: (input) => {
        resolvedStages.push(input);
      },
      sha256: "sha256",
    });

    expect(stageId).toBe("stage-resume");
    // The stage already existed, so it was never re-initiated (no orphan)...
    expect(initiateCalls).toEqual([]);
    // ...and the part the server already had was not re-uploaded.
    expect(uploadedPartNumbers).toEqual([2]);
    expect(resolvedStages).toEqual([{ partSize: 3, stageId: "stage-resume" }]);
  });

  test("opens a fresh stage when the resume target is gone", async () => {
    const resolvedStages: Array<{ partSize: number; stageId: string }> = [];
    const stageId = await stageMultipartBlobAttachment({
      apiClient: {
        bindBlobAttachment: async () => null,
        completeMultipartBlobStage: async (id) => ({
          byteLength: 6,
          expiresAt: "2026-04-27T01:00:00.000Z",
          sha256: "sha256",
          stageId: id,
        }),
        getDocumentWriterProjection: async () => null,
        getMultipartBlobStage: async () => null,
        initiateMultipartBlobStage: async () => ({
          byteLength: 6,
          expiresAt: "2026-04-27T01:00:00.000Z",
          sha256: "sha256",
          stageId: "stage-fresh",
          uploadedParts: [],
          uploadId: "upload-fresh",
        }),
        stageBlob: async () => null,
        uploadMultipartBlobPart: async (id, partNumber, input) => ({
          part: {
            byteLength: input.encryptedBytes.length,
            etag: `etag-${partNumber}`,
            partNumber,
          },
          stageId: id,
          uploadId: input.uploadId,
        }),
      },
      byteLength: 6,
      encryptedBytes: "abcdef",
      multipart: { partSize: 3, resumeStageId: "stage-missing" },
      onStageResolved: (input) => {
        resolvedStages.push(input);
      },
      sha256: "sha256",
    });

    expect(stageId).toBe("stage-fresh");
    expect(resolvedStages).toEqual([{ partSize: 3, stageId: "stage-fresh" }]);
  });

  test("opens a fresh stage when the resumed stage was opened for different bytes", async () => {
    const initiateCalls: number[] = [];
    const stageId = await stageMultipartBlobAttachment({
      apiClient: {
        bindBlobAttachment: async () => null,
        completeMultipartBlobStage: async (id) => ({
          byteLength: 6,
          expiresAt: "2026-04-27T01:00:00.000Z",
          sha256: "sha256",
          stageId: id,
        }),
        getDocumentWriterProjection: async () => null,
        getMultipartBlobStage: async (id) => ({
          byteLength: 6,
          completed: false,
          expiresAt: "2026-04-27T01:00:00.000Z",
          // A stage recorded for different content must not be resumed: its parts
          // could never assemble to the sha256 this upload will complete against.
          sha256: "stale-sha256",
          stageId: id,
          uploadId: "upload-stale",
          uploadedParts: [{ byteLength: 3, etag: "etag-1", partNumber: 1 }],
        }),
        initiateMultipartBlobStage: async () => {
          initiateCalls.push(1);
          return {
            byteLength: 6,
            expiresAt: "2026-04-27T01:00:00.000Z",
            sha256: "sha256",
            stageId: "stage-fresh",
            uploadedParts: [],
            uploadId: "upload-fresh",
          };
        },
        stageBlob: async () => null,
        uploadMultipartBlobPart: async (id, partNumber, input) => ({
          part: {
            byteLength: input.encryptedBytes.length,
            etag: `etag-${partNumber}`,
            partNumber,
          },
          stageId: id,
          uploadId: input.uploadId,
        }),
      },
      byteLength: 6,
      encryptedBytes: "abcdef",
      multipart: { partSize: 3, resumeStageId: "stage-stale" },
      sha256: "sha256",
    });

    expect(stageId).toBe("stage-fresh");
    expect(initiateCalls).toEqual([1]);
  });

  test("rejects multipart plans that exceed the object store part limit", async () => {
    await expect(
      stageMultipartBlobAttachment({
        apiClient: {
          bindBlobAttachment: async () => null,
          completeMultipartBlobStage: async () => null,
          getDocumentWriterProjection: async () => null,
          getMultipartBlobStage: async () => null,
          initiateMultipartBlobStage: async () => ({
            byteLength: 10_001,
            expiresAt: "2026-04-27T01:00:00.000Z",
            sha256: "sha256",
            stageId: "stage-too-many-parts",
            uploadedParts: [],
            uploadId: "upload-too-many-parts",
          }),
          stageBlob: async () => null,
          uploadMultipartBlobPart: async () => null,
        },
        byteLength: 10_001,
        encryptedBytes: "a".repeat(10_001),
        multipart: { partSize: 1 },
        sha256: "sha256",
      }),
    ).rejects.toThrow(
      "Multipart blob upload would require 10,001 parts; the maximum is 10,000.",
    );
  });
});
