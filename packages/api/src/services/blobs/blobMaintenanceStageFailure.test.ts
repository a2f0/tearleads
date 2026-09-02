import { expect, test } from "bun:test";
import { db } from "@tearleads/api-shared/postgres";
import { blobStages } from "@tearleads/api-shared/schema";
import { eq } from "drizzle-orm";
import { createServiceTestRuntime } from "../../../test/helpers/serviceRuntime";
import { runBlobMaintenance } from "./blobMaintenance";

test("failed expired-stage cleanup fails the maintenance run", async () => {
  const baseRuntime = createServiceTestRuntime();
  const stageId = crypto.randomUUID();
  const storageKey = `blob-stages/${stageId}`;
  const { uploadId } = await baseRuntime.blobObjectStore.createMultipartUpload({
    key: storageKey,
  });
  await db.insert(blobStages).values({
    byteLength: 1,
    expiresAt: new Date("2000-01-01T00:00:00.000Z"),
    id: stageId,
    ownerUserId: crypto.randomUUID(),
    sha256: "expired-stage-digest",
    storageKey,
    uploadId,
  });
  const runtime: typeof baseRuntime = {
    ...baseRuntime,
    blobObjectStore: {
      ...baseRuntime.blobObjectStore,
      abortMultipartUpload: async () => {
        throw new Error("Simulated abort failure");
      },
    },
  };

  const maintenanceError = await runBlobMaintenance(runtime, {
    dereferencedBlobs: { blobIds: [] },
    expiredStages: { now: new Date("2000-01-02T00:00:00.000Z") },
  }).then(
    () => null,
    (error: unknown) => error,
  );

  expect(maintenanceError).toBeInstanceOf(AggregateError);
  expect(maintenanceError).toMatchObject({
    errors: expect.arrayContaining([
      expect.objectContaining({
        message: expect.stringMatching(
          /^Expired blob stage cleanup encountered [1-9]\d* failure\(s\)$/,
        ),
      }),
    ]),
    message: "Blob maintenance failed",
  });
  const remainingStages = await db
    .select({ id: blobStages.id })
    .from(blobStages)
    .where(eq(blobStages.id, stageId));
  expect(remainingStages).toEqual([{ id: stageId }]);
  await db.delete(blobStages).where(eq(blobStages.id, stageId));
});
