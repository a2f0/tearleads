import { expect, test } from "bun:test";
import { blobStages } from "@tearleads/api-shared/schema";
import { eq } from "drizzle-orm";
import {
  blobObjectBytes,
  readBlobObjectText,
  uploadBlobObject,
} from "../../../test/helpers/blobObjectStore";
import { createBlobStageOwner } from "../../../test/helpers/blobStageOwner";
import { createFakeS3BlobObjectStore } from "../../../test/helpers/fakeS3BlobObjectStore";
import { createServiceTestRuntime } from "../../../test/helpers/serviceRuntime";
import { sha256Hex } from "../../utils/sha256";
import type { ApiServiceRuntime } from "../runtime";
import {
  cleanupExpiredBlobStages,
  completeMultipartBlobStage,
  getMultipartBlobStage,
  initiateMultipartBlobStage,
  MultipartBlobStageError,
  uploadMultipartBlobPartBytes,
} from "./multipartStage";

async function createMultipartStageInput(encryptedBytes: string) {
  return {
    byteLength: new TextEncoder().encode(encryptedBytes).byteLength,
    sha256: await sha256Hex(encryptedBytes),
  };
}

async function uploadTextPart(
  runtime: ApiServiceRuntime,
  input: {
    readonly encryptedBytes: string;
    readonly partNumber: number;
    readonly stageId: string;
    readonly uploadId: string;
    readonly userId: string;
  },
) {
  return uploadMultipartBlobPartBytes(runtime, {
    ...(await createMultipartStageInput(input.encryptedBytes)),
    bytes: blobObjectBytes(input.encryptedBytes),
    partNumber: input.partNumber,
    stageId: input.stageId,
    uploadId: input.uploadId,
    userId: input.userId,
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
  const { userId, organizationId } = await createBlobStageOwner();
  const encryptedBytes = "multipart-recovery-payload";
  const initiated = await initiateMultipartBlobStage(runtime, {
    organizationId,
    ...(await createMultipartStageInput(encryptedBytes)),
    userId,
  });
  const part = await uploadTextPart(runtime, {
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

  // Simulate a crash after object completion but before the row state flip.
  await runtime.db
    .update(blobStages)
    .set({ completedAt: null })
    .where(eq(blobStages.id, initiated.stageId));

  // A retry must recognize the assembled object and converge to complete.
  const recovered = await completeMultipartBlobStage(runtime, completeArgs);
  expect(recovered.stageId).toBe(initiated.stageId);
  expect(recovered.sha256).toBe(initiated.sha256);

  const [after] = await runtime.db
    .select({ completedAt: blobStages.completedAt })
    .from(blobStages)
    .where(eq(blobStages.id, initiated.stageId));
  expect(after?.completedAt).not.toBeNull();
});

test("completeMultipartBlobStage recovery fails closed when the surviving object does not match", async () => {
  const runtime = createServiceTestRuntime();
  const { userId, organizationId } = await createBlobStageOwner();
  const encryptedBytes = "multipart-recovery-original";
  const initiated = await initiateMultipartBlobStage(runtime, {
    organizationId,
    ...(await createMultipartStageInput(encryptedBytes)),
    userId,
  });
  const part = await uploadTextPart(runtime, {
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
  await completeMultipartBlobStage(runtime, completeArgs);

  // Replace the surviving object with mismatched bytes and reset the row.
  const [row] = await runtime.db
    .select({ storageKey: blobStages.storageKey })
    .from(blobStages)
    .where(eq(blobStages.id, initiated.stageId));
  if (!row) {
    throw new Error("Expected a multipart stage row");
  }
  const mismatchedBytes = "totally-different-bytes";
  await uploadBlobObject(
    runtime.blobObjectStore,
    row.storageKey,
    mismatchedBytes,
  );
  await runtime.db
    .update(blobStages)
    .set({ completedAt: null })
    .where(eq(blobStages.id, initiated.stageId));

  // Recovery must re-validate and reject the mismatched object, not accept it.
  const failure = await expectMultipartBlobStageError(
    completeMultipartBlobStage(runtime, completeArgs),
  );
  expect(failure.status).toBe(409);
  expect(
    await readBlobObjectText(runtime.blobObjectStore, row.storageKey),
  ).toBeNull();
});

test("multipart blob stages upload resumable parts outside Postgres", async () => {
  const runtime = createServiceTestRuntime();
  const { userId, organizationId } = await createBlobStageOwner();
  const encryptedBytes = "multipart-encrypted-payload";
  const initiated = await initiateMultipartBlobStage(runtime, {
    organizationId,
    ...(await createMultipartStageInput(encryptedBytes)),
    userId,
  });

  const secondPart = await uploadTextPart(runtime, {
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

  const firstPart = await uploadTextPart(runtime, {
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
    organizationId,
    byteLength: initiated.byteLength,
    expiresAt: initiated.expiresAt,
    sha256: initiated.sha256,
    stageId: initiated.stageId,
  });

  const [storedStage] = await runtime.db
    .select({
      completedAt: blobStages.completedAt,
      ownerUserId: blobStages.ownerUserId,
      storageKey: blobStages.storageKey,
      uploadId: blobStages.uploadId,
    })
    .from(blobStages)
    .where(eq(blobStages.id, initiated.stageId))
    .limit(1);
  expect(storedStage?.ownerUserId).toBe(userId);
  expect(storedStage).toMatchObject({
    uploadId: initiated.uploadId,
  });
  expect(storedStage?.completedAt).not.toBeNull();
  expect(
    storedStage
      ? await readBlobObjectText(
          runtime.blobObjectStore,
          storedStage.storageKey,
        )
      : null,
  ).toBe(encryptedBytes);
});

test("S3 multipart completion rejects and deletes mismatched bytes", async () => {
  const { store } = createFakeS3BlobObjectStore();
  const runtime = createServiceTestRuntime(undefined, {
    blobObjectStore: store,
  });
  const { userId, organizationId } = await createBlobStageOwner();
  const initiated = await initiateMultipartBlobStage(runtime, {
    organizationId,
    ...(await createMultipartStageInput("expected-bytes")),
    userId,
  });
  const part = await uploadTextPart(runtime, {
    encryptedBytes: "tampered-bytes",
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
  expect(error.message).toBe("Blob sha256 does not match multipart upload");
  await expect(
    readBlobObjectText(
      runtime.blobObjectStore,
      `organizations/${organizationId}/blob-stages/${initiated.stageId}`,
    ),
  ).resolves.toBeNull();
});

test("multipart blob stages accept streamed part uploads", async () => {
  const runtime = createServiceTestRuntime();
  const { userId, organizationId } = await createBlobStageOwner();
  const encryptedBytes = "streamed-multipart-part";
  const initiated = await initiateMultipartBlobStage(runtime, {
    organizationId,
    ...(await createMultipartStageInput(encryptedBytes)),
    userId,
  });

  const part = await uploadMultipartBlobPartBytes(runtime, {
    ...(await createMultipartStageInput(encryptedBytes)),
    bytes: blobObjectBytes(encryptedBytes),
    partNumber: 1,
    stageId: initiated.stageId,
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
  const { userId, organizationId } = await createBlobStageOwner();
  const expiredAt = new Date("2000-01-01T00:00:00.000Z");
  const pending = await initiateMultipartBlobStage(runtime, {
    organizationId,
    ...(await createMultipartStageInput("pending-expired-bytes")),
    userId,
  });
  await uploadTextPart(runtime, {
    encryptedBytes: "pending",
    partNumber: 1,
    stageId: pending.stageId,
    uploadId: pending.uploadId,
    userId,
  });
  const completed = await initiateMultipartBlobStage(runtime, {
    organizationId,
    ...(await createMultipartStageInput("completed-expired-bytes")),
    userId,
  });
  const completedPart = await uploadTextPart(runtime, {
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
  await runtime.db
    .update(blobStages)
    .set({ expiresAt: expiredAt })
    .where(eq(blobStages.ownerUserId, userId));

  const result = await cleanupExpiredBlobStages(runtime, {
    now: expiredAt,
  });
  expect(result).toEqual({
    abortedMultipartUploads: 1,
    deletedMultipartObjects: 1,
    deletedStages: 2,
    failedStages: 0,
    failures: [],
    scannedStages: 2,
  });
  await expect(
    runtime.blobObjectStore.createMultipartUpload({
      key: `organizations/${organizationId}/blob-stages/${pending.stageId}`,
    }),
  ).resolves.toHaveProperty("uploadId");
  await expect(
    readBlobObjectText(
      runtime.blobObjectStore,
      `organizations/${organizationId}/blob-stages/${completed.stageId}`,
    ),
  ).resolves.toBeNull();

  const remainingStages = await runtime.db
    .select({ id: blobStages.id })
    .from(blobStages)
    .where(eq(blobStages.ownerUserId, userId));
  expect(remainingStages).toEqual([]);
});

test("expired blob stage cleanup continues after object store cleanup failures", async () => {
  const baseRuntime = createServiceTestRuntime();
  const { userId, organizationId } = await createBlobStageOwner();
  const expiredAt = new Date("2000-01-01T00:00:00.000Z");
  const pending = await initiateMultipartBlobStage(baseRuntime, {
    organizationId,
    ...(await createMultipartStageInput("pending-failure-bytes")),
    userId,
  });
  const completed = await initiateMultipartBlobStage(baseRuntime, {
    organizationId,
    ...(await createMultipartStageInput("completed-after-failure")),
    userId,
  });
  const completedPart = await uploadTextPart(baseRuntime, {
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
        if (
          input.key ===
          `organizations/${organizationId}/blob-stages/${pending.stageId}`
        ) {
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
    deletedMultipartObjects: 1,
    deletedStages: 1,
    failedStages: 1,
    failures: [expect.objectContaining({ message: "Simulated abort failure" })],
    scannedStages: 2,
  });
  await expect(
    readBlobObjectText(
      runtime.blobObjectStore,
      `organizations/${organizationId}/blob-stages/${completed.stageId}`,
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
  const { userId, organizationId } = await createBlobStageOwner();
  const expiredAt = new Date("2000-01-01T00:00:00.000Z");
  const first = await initiateMultipartBlobStage(runtime, {
    organizationId,
    ...(await createMultipartStageInput("first-expired")),
    userId,
  });
  const second = await initiateMultipartBlobStage(runtime, {
    organizationId,
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
