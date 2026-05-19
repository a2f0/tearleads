import { expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { createServiceTestRuntime } from "../../../test/helpers/serviceRuntime";
import { blobStages } from "../../schema";
import { readMultipartBlobStageRecord } from "../../utils/blobStageRecords";
import { sha256Hex } from "../../utils/sha256";
import {
  completeMultipartBlobStage,
  getMultipartBlobStage,
  initiateMultipartBlobStage,
  MultipartBlobStageError,
  uploadMultipartBlobPart,
} from "./multipartStage";

async function createMultipartStageInput(encryptedBytes: string) {
  return {
    byteLength: new TextEncoder().encode(encryptedBytes).byteLength,
    sha256: await sha256Hex(encryptedBytes),
  };
}

async function expectMultipartBlobStageError(
  promise: Promise<unknown>,
): Promise<MultipartBlobStageError> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(MultipartBlobStageError);
    return error as MultipartBlobStageError;
  }

  throw new Error("Expected multipart blob stage to fail");
}

test("multipart blob stages upload resumable parts outside Postgres", async () => {
  const runtime = createServiceTestRuntime();
  const userId = crypto.randomUUID();
  const encryptedBytes = "multipart-encrypted-payload";
  const initiated = await initiateMultipartBlobStage(runtime, {
    ...(await createMultipartStageInput(encryptedBytes)),
    userId,
  });

  const secondPart = await uploadMultipartBlobPart(runtime, {
    encryptedBytes: "-encrypted-payload",
    partNumber: 2,
    stageId: initiated.stageId,
    uploadId: initiated.uploadId,
    userId,
  });
  const resumeStatus = await getMultipartBlobStage(runtime, {
    stageId: initiated.stageId,
    userId,
  });
  expect(resumeStatus.completed).toBe(false);
  expect(resumeStatus.uploadedParts).toEqual([secondPart.part]);

  const firstPart = await uploadMultipartBlobPart(runtime, {
    encryptedBytes: "multipart",
    partNumber: 1,
    stageId: initiated.stageId,
    uploadId: initiated.uploadId,
    userId,
  });
  const completed = await completeMultipartBlobStage(runtime, {
    parts: [
      { etag: secondPart.part.etag, partNumber: 2 },
      { etag: firstPart.part.etag, partNumber: 1 },
    ],
    stageId: initiated.stageId,
    uploadId: initiated.uploadId,
    userId,
  });
  expect(completed).toEqual({
    byteLength: initiated.byteLength,
    expiresAt: initiated.expiresAt,
    sha256: initiated.sha256,
    stageId: initiated.stageId,
  });

  const [storedStage] = await runtime.db
    .select({
      encryptedBytes: blobStages.encryptedBytes,
      ownerUserId: blobStages.ownerUserId,
    })
    .from(blobStages)
    .where(eq(blobStages.id, initiated.stageId))
    .limit(1);
  expect(storedStage?.ownerUserId).toBe(userId);
  expect(storedStage?.encryptedBytes).not.toBe(encryptedBytes);

  const stageRecord = readMultipartBlobStageRecord(
    storedStage?.encryptedBytes ?? "",
  );
  expect(stageRecord).toMatchObject({
    state: "complete",
    uploadId: initiated.uploadId,
  });
  expect(
    stageRecord
      ? await runtime.blobObjectStore.getObject(stageRecord.storageKey)
      : null,
  ).toBe(encryptedBytes);
});

test("multipart blob stage completion rejects mismatched bytes", async () => {
  const runtime = createServiceTestRuntime();
  const userId = crypto.randomUUID();
  const initiated = await initiateMultipartBlobStage(runtime, {
    ...(await createMultipartStageInput("expected-bytes")),
    userId,
  });
  const part = await uploadMultipartBlobPart(runtime, {
    encryptedBytes: "unexpected-bytes",
    partNumber: 1,
    stageId: initiated.stageId,
    uploadId: initiated.uploadId,
    userId,
  });

  const error = await expectMultipartBlobStageError(
    completeMultipartBlobStage(runtime, {
      parts: [{ etag: part.part.etag, partNumber: 1 }],
      stageId: initiated.stageId,
      uploadId: initiated.uploadId,
      userId,
    }),
  );

  expect(error.status).toBe(409);
  expect(error.message).toBe("Blob byteLength does not match multipart upload");
});
