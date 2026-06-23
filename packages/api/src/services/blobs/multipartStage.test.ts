import { expect, test } from "bun:test";
import { blobStages } from "@tearleads/api-shared/schema";
import { eq } from "drizzle-orm";
import { readBlobObjectText } from "../../../test/helpers/blobObjectStore";
import { createServiceTestRuntime } from "../../../test/helpers/serviceRuntime";
import {
  encodeMultipartBlobStageRecord,
  readMultipartBlobStageRecord,
} from "../../utils/blobStageRecords";
import { sha256Hex } from "../../utils/sha256";
import {
  cleanupExpiredBlobStages,
  completeMultipartBlobStage,
  getMultipartBlobStage,
  initiateMultipartBlobStage,
  MultipartBlobStageError,
  uploadMultipartBlobPart,
  uploadMultipartBlobPartStream,
} from "./multipartStage";

async function createMultipartStageInput(encryptedBytes: string) {
  return {
    byteLength: new TextEncoder().encode(encryptedBytes).byteLength,
    sha256: await sha256Hex(encryptedBytes),
  };
}

function textStream(value: string): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(value));
      controller.close();
    },
  });
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

test("completeMultipartBlobStage recovers a pending record whose object was already assembled", async () => {
  const runtime = createServiceTestRuntime();
  const userId = crypto.randomUUID();
  const encryptedBytes = "multipart-recovery-payload";
  const initiated = await initiateMultipartBlobStage(runtime, {
    ...(await createMultipartStageInput(encryptedBytes)),
    userId,
  });
  const part = await uploadMultipartBlobPart(runtime, {
    encryptedBytes,
    partNumber: 1,
    stageId: initiated.stageId,
    uploadId: initiated.uploadId,
    userId,
  });
  const completeArgs = {
    parts: [{ etag: part.part.etag, partNumber: 1 }],
    stageId: initiated.stageId,
    uploadId: initiated.uploadId,
    userId,
  };

  // First complete assembles the object and flips the record to complete.
  await completeMultipartBlobStage(runtime, completeArgs);

  // Simulate a crash after the object-store byte commit but before the state
  // flip committed: the assembled object survives, but the record is still
  // pending and the uploadId has already been consumed by the store.
  const [row] = await runtime.db
    .select({ encryptedBytes: blobStages.encryptedBytes })
    .from(blobStages)
    .where(eq(blobStages.id, initiated.stageId));
  const record = readMultipartBlobStageRecord(row?.encryptedBytes ?? "");
  if (!record) {
    throw new Error("Expected a multipart stage record");
  }
  await runtime.db
    .update(blobStages)
    .set({
      encryptedBytes: encodeMultipartBlobStageRecord({
        state: "pending",
        storageKey: record.storageKey,
        uploadId: record.uploadId,
      }),
    })
    .where(eq(blobStages.id, initiated.stageId));

  // Retrying complete (uploadId now gone at the store) must converge to complete
  // by recognizing the already-assembled object, not fail with 404.
  const recovered = await completeMultipartBlobStage(runtime, completeArgs);
  expect(recovered.stageId).toBe(initiated.stageId);
  expect(recovered.sha256).toBe(initiated.sha256);

  const [after] = await runtime.db
    .select({ encryptedBytes: blobStages.encryptedBytes })
    .from(blobStages)
    .where(eq(blobStages.id, initiated.stageId));
  expect(readMultipartBlobStageRecord(after?.encryptedBytes ?? "")?.state).toBe(
    "complete",
  );
});

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
      ? await readBlobObjectText(
          runtime.blobObjectStore,
          stageRecord.storageKey,
        )
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

test("multipart blob stages accept streamed part uploads", async () => {
  const runtime = createServiceTestRuntime();
  const userId = crypto.randomUUID();
  const encryptedBytes = "streamed-multipart-part";
  const initiated = await initiateMultipartBlobStage(runtime, {
    ...(await createMultipartStageInput(encryptedBytes)),
    userId,
  });

  const part = await uploadMultipartBlobPartStream(runtime, {
    ...(await createMultipartStageInput(encryptedBytes)),
    partNumber: 1,
    stageId: initiated.stageId,
    stream: textStream(encryptedBytes),
    uploadId: initiated.uploadId,
    userId,
  });
  const completed = await completeMultipartBlobStage(runtime, {
    parts: [{ etag: part.part.etag, partNumber: 1 }],
    stageId: initiated.stageId,
    uploadId: initiated.uploadId,
    userId,
  });

  expect(completed.sha256).toBe(initiated.sha256);
});

test("expired blob stage cleanup aborts pending multipart uploads and deletes completed objects", async () => {
  const runtime = createServiceTestRuntime();
  const userId = crypto.randomUUID();
  const expiredAt = new Date("2000-01-01T00:00:00.000Z");
  const pending = await initiateMultipartBlobStage(runtime, {
    ...(await createMultipartStageInput("pending-expired-bytes")),
    userId,
  });
  await uploadMultipartBlobPart(runtime, {
    encryptedBytes: "pending",
    partNumber: 1,
    stageId: pending.stageId,
    uploadId: pending.uploadId,
    userId,
  });
  const completed = await initiateMultipartBlobStage(runtime, {
    ...(await createMultipartStageInput("completed-expired-bytes")),
    userId,
  });
  const completedPart = await uploadMultipartBlobPart(runtime, {
    encryptedBytes: "completed-expired-bytes",
    partNumber: 1,
    stageId: completed.stageId,
    uploadId: completed.uploadId,
    userId,
  });
  await completeMultipartBlobStage(runtime, {
    parts: [{ etag: completedPart.part.etag, partNumber: 1 }],
    stageId: completed.stageId,
    uploadId: completed.uploadId,
    userId,
  });
  await runtime.db.insert(blobStages).values({
    byteLength: 12,
    encryptedBytes: "legacy-bytes",
    expiresAt: expiredAt,
    ownerUserId: userId,
    sha256: "legacy-sha256",
  });
  await runtime.db
    .update(blobStages)
    .set({ expiresAt: expiredAt })
    .where(eq(blobStages.ownerUserId, userId));

  const result = await cleanupExpiredBlobStages(runtime, {
    now: expiredAt,
  });

  expect(result).toEqual({
    abortedMultipartUploads: 1,
    deletedLegacyStages: 1,
    deletedMultipartObjects: 1,
    deletedStages: 3,
    failedStages: 0,
    scannedStages: 3,
  });
  await expect(
    runtime.blobObjectStore.createMultipartUpload({
      key: `blob-stages/${pending.stageId}`,
    }),
  ).resolves.toHaveProperty("uploadId");
  await expect(
    readBlobObjectText(
      runtime.blobObjectStore,
      `blob-stages/${completed.stageId}`,
    ),
  ).resolves.toBeNull();

  const remainingStages = await runtime.db
    .select({ encryptedBytes: blobStages.encryptedBytes })
    .from(blobStages)
    .where(eq(blobStages.ownerUserId, userId));
  expect(remainingStages).toEqual([]);
});

test("expired blob stage cleanup continues after object store cleanup failures", async () => {
  const baseRuntime = createServiceTestRuntime();
  const userId = crypto.randomUUID();
  const expiredAt = new Date("2000-01-01T00:00:00.000Z");
  const pending = await initiateMultipartBlobStage(baseRuntime, {
    ...(await createMultipartStageInput("pending-failure-bytes")),
    userId,
  });
  const completed = await initiateMultipartBlobStage(baseRuntime, {
    ...(await createMultipartStageInput("completed-after-failure")),
    userId,
  });
  const completedPart = await uploadMultipartBlobPart(baseRuntime, {
    encryptedBytes: "completed-after-failure",
    partNumber: 1,
    stageId: completed.stageId,
    uploadId: completed.uploadId,
    userId,
  });
  await completeMultipartBlobStage(baseRuntime, {
    parts: [{ etag: completedPart.part.etag, partNumber: 1 }],
    stageId: completed.stageId,
    uploadId: completed.uploadId,
    userId,
  });
  await baseRuntime.db
    .update(blobStages)
    .set({ expiresAt: expiredAt })
    .where(eq(blobStages.ownerUserId, userId));
  const runtime: typeof baseRuntime = {
    ...baseRuntime,
    blobObjectStore: {
      ...baseRuntime.blobObjectStore,
      abortMultipartUpload: async (input) => {
        if (input.key === `blob-stages/${pending.stageId}`) {
          throw new Error("Simulated abort failure");
        }

        return baseRuntime.blobObjectStore.abortMultipartUpload(input);
      },
    },
  };

  const result = await cleanupExpiredBlobStages(runtime, {
    now: expiredAt,
  });

  expect(result).toEqual({
    abortedMultipartUploads: 0,
    deletedLegacyStages: 0,
    deletedMultipartObjects: 1,
    deletedStages: 1,
    failedStages: 1,
    scannedStages: 2,
  });
  await expect(
    readBlobObjectText(
      runtime.blobObjectStore,
      `blob-stages/${completed.stageId}`,
    ),
  ).resolves.toBeNull();
  const remainingStageIds = (
    await runtime.db
      .select({ id: blobStages.id })
      .from(blobStages)
      .where(eq(blobStages.ownerUserId, userId))
  ).map((stage) => stage.id);
  expect(remainingStageIds).toEqual([pending.stageId]);
  await runtime.db.delete(blobStages).where(eq(blobStages.id, pending.stageId));
});

test("expired blob stage cleanup respects its batch limit", async () => {
  const runtime = createServiceTestRuntime();
  const userId = crypto.randomUUID();
  const expiredAt = new Date("2000-01-01T00:00:00.000Z");
  const first = await initiateMultipartBlobStage(runtime, {
    ...(await createMultipartStageInput("first-expired")),
    userId,
  });
  const second = await initiateMultipartBlobStage(runtime, {
    ...(await createMultipartStageInput("second-expired")),
    userId,
  });
  await runtime.db
    .update(blobStages)
    .set({ expiresAt: expiredAt })
    .where(eq(blobStages.ownerUserId, userId));

  const result = await cleanupExpiredBlobStages(runtime, {
    limit: 1,
    now: expiredAt,
  });

  expect(result.scannedStages).toBe(1);
  expect(result.deletedStages).toBe(1);
  const remainingStageIds = (
    await runtime.db
      .select({ id: blobStages.id })
      .from(blobStages)
      .where(eq(blobStages.ownerUserId, userId))
  ).map((stage) => stage.id);
  expect(remainingStageIds).toHaveLength(1);
  const [remainingStageId] = remainingStageIds;
  if (!remainingStageId) {
    throw new Error("Expected one remaining expired blob stage");
  }
  expect([first.stageId, second.stageId]).toContain(remainingStageId);
});
