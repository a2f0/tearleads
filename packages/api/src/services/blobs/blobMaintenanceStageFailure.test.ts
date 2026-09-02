import { expect, test } from "bun:test";
import {
  createDefaultManagedApiDatabase,
  type ManagedApiDatabase,
} from "@tearleads/api-shared/postgres";
import { blobStages } from "@tearleads/api-shared/schema";
import { eq } from "drizzle-orm";
import { createServiceTestRuntime } from "../../../test/helpers/serviceRuntime";
import { runBlobMaintenance } from "./blobMaintenance";

async function assertFailedStageCleanup(
  managedDatabase: ManagedApiDatabase,
): Promise<void> {
  const baseRuntime = createServiceTestRuntime(managedDatabase.db);
  const stageId = crypto.randomUUID();
  const storageKey = `blob-stages/${stageId}`;
  const { uploadId } = await baseRuntime.blobObjectStore.createMultipartUpload({
    key: storageKey,
  });
  await managedDatabase.db.insert(blobStages).values({
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
          /^Expired blob stage cleanup encountered 1 failure\(s\): Simulated abort failure$/,
        ),
        errors: [
          expect.objectContaining({ message: "Simulated abort failure" }),
        ],
      }),
    ]),
    message: "Blob maintenance failed",
  });
  const remainingStages = await managedDatabase.db
    .select({ id: blobStages.id })
    .from(blobStages)
    .where(eq(blobStages.id, stageId));
  expect(remainingStages).toEqual([{ id: stageId }]);
}

test("failed expired-stage cleanup fails the maintenance run", async () => {
  const { API_DATABASE: apiDatabase } = process.env;
  const databaseKind = apiDatabase === "sqlite" ? "sqlite" : "memory";
  const managedDatabase = createDefaultManagedApiDatabase({
    API_DATABASE: databaseKind,
    ...(databaseKind === "sqlite"
      ? { API_SQLITE_PATH: ":memory:", SQLITE_PATH: ":memory:" }
      : {}),
  });
  try {
    await managedDatabase.migrate();
    await assertFailedStageCleanup(managedDatabase);
  } finally {
    await managedDatabase.close();
  }
});
