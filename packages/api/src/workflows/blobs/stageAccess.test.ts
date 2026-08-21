import { expect, test } from "bun:test";
import { blobStages } from "@symcrypt/api-shared/schema";
import { eq } from "drizzle-orm";
import { createServiceTestRuntime } from "../../../test/helpers/serviceRuntime";
import { loadOwnedActiveBlobStage } from "./stageAccess";

class StageAccessError extends Error {
  constructor(
    message: string,
    readonly status: 403 | 404 | 409,
  ) {
    super(message);
  }
}

function stageAccessError(
  message: string,
  status: 403 | 404 | 409,
): StageAccessError {
  return new StageAccessError(message, status);
}

async function expectStageAccessError(
  promise: Promise<unknown>,
): Promise<StageAccessError> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(StageAccessError);
    return error as StageAccessError;
  }
  throw new Error("Expected stage access to fail");
}

test("loads only an owned, unexpired blob stage", async () => {
  const runtime = createServiceTestRuntime();
  const stageId = crypto.randomUUID();
  const userId = crypto.randomUUID();
  await runtime.db.insert(blobStages).values({
    byteLength: 12,
    expiresAt: new Date("2100-01-01T00:00:00.000Z"),
    id: stageId,
    ownerUserId: userId,
    sha256: "stage-sha256",
    storageKey: `blob-stages/${stageId}`,
    uploadId: "upload-1",
  });

  await expect(
    loadOwnedActiveBlobStage(runtime.db, {
      error: stageAccessError,
      stageId,
      userId,
    }),
  ).resolves.toMatchObject({
    byteLength: 12,
    id: stageId,
    ownerUserId: userId,
    uploadId: "upload-1",
  });

  const forbidden = await expectStageAccessError(
    loadOwnedActiveBlobStage(runtime.db, {
      error: stageAccessError,
      stageId,
      userId: crypto.randomUUID(),
    }),
  );
  expect([forbidden.message, forbidden.status]).toEqual(["Forbidden", 403]);

  const missing = await expectStageAccessError(
    loadOwnedActiveBlobStage(runtime.db, {
      error: stageAccessError,
      stageId: crypto.randomUUID(),
      userId,
    }),
  );
  expect([missing.message, missing.status]).toEqual([
    "Blob stage not found",
    404,
  ]);

  await runtime.db
    .update(blobStages)
    .set({ expiresAt: new Date("2000-01-01T00:00:00.000Z") })
    .where(eq(blobStages.id, stageId));
  const expired = await expectStageAccessError(
    loadOwnedActiveBlobStage(runtime.db, {
      error: stageAccessError,
      stageId,
      userId,
    }),
  );
  expect([expired.message, expired.status]).toEqual([
    "Blob stage has expired",
    409,
  ]);
  await runtime.db.delete(blobStages).where(eq(blobStages.id, stageId));
});
