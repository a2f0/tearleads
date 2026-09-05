import { expect, test } from "bun:test";
import { db } from "@tearleads/api-shared/postgres";
import {
  blobAuditObjects,
  blobStages,
  blobs,
} from "@tearleads/api-shared/schema";
import { eq } from "drizzle-orm";
import {
  readBlobObjectText,
  uploadBlobObject,
} from "../../../test/helpers/blobObjectStore";
import { createServiceTestRuntime } from "../../../test/helpers/serviceRuntime";
import { createMemoryBlobObjectStore } from "../../adapters/blobObjectStore";
import { sha256Hex } from "../../utils/sha256";
import {
  reclaimDereferencedBlobs,
  runBlobMaintenance,
} from "./blobMaintenance";

const ORGANIZATION_ID = "fd48148f-2bb0-420d-925a-7007d5c1c40f";

const HOUR_MS = 60 * 60 * 1000;

async function insertReclaimableBlob(input: {
  readonly blobId: string;
  readonly byteLength: number;
  readonly sha256: string;
  readonly storageKey: string;
}): Promise<void> {
  await db.insert(blobs).values({
    id: input.blobId,
    storageKey: input.storageKey,
    sha256: input.sha256,
    byteLength: input.byteLength,
    dereferencedAt: new Date(Date.now() - 48 * HOUR_MS),
  });
  await db.insert(blobAuditObjects).values({
    blobId: input.blobId,
    byteLength: input.byteLength,
    historicalBytesRetained: false,
    liveStorageKey: input.storageKey,
    organizationId: ORGANIZATION_ID,
    retentionMode: "live_only",
    sha256: input.sha256,
  });
}

test("reclaimDereferencedBlobs deletes the reclaimed object-store bytes after commit", async () => {
  const runtime = createServiceTestRuntime();
  const blobId = crypto.randomUUID();
  const storageKey = `organizations/${ORGANIZATION_ID}/blob-stages/${blobId}`;
  const bytes = "reclaimable-bytes";
  await uploadBlobObject(runtime.blobObjectStore, storageKey, bytes);
  await insertReclaimableBlob({
    blobId,
    byteLength: bytes.length,
    sha256: await sha256Hex(bytes),
    storageKey,
  });

  const summary = await reclaimDereferencedBlobs(runtime, {
    gracePeriodMs: 24 * HOUR_MS,
  });

  expect(summary.reclaimedCount).toBeGreaterThanOrEqual(1);
  expect(summary.deletedObjectCount).toBeGreaterThanOrEqual(1);
  expect(
    await readBlobObjectText(runtime.blobObjectStore, storageKey),
  ).toBeNull();
  const [auditObject] = await db
    .select({
      liveStorageKey: blobAuditObjects.liveStorageKey,
      objectDeletedAt: blobAuditObjects.objectDeletedAt,
      prunedAt: blobAuditObjects.prunedAt,
    })
    .from(blobAuditObjects)
    .where(eq(blobAuditObjects.blobId, blobId));
  expect(auditObject?.liveStorageKey).toBeNull();
  expect(auditObject?.prunedAt).toBeInstanceOf(Date);
  expect(auditObject?.objectDeletedAt).toBeInstanceOf(Date);
});

test("failed object deletion remains durable and a later sweep records completion", async () => {
  const objectStore = createMemoryBlobObjectStore();
  let shouldFailDeletion = true;
  const runtime = createServiceTestRuntime(db, {
    blobObjectStore: {
      ...objectStore,
      async deleteObject(key) {
        if (shouldFailDeletion) {
          shouldFailDeletion = false;
          throw new Error("object store unavailable");
        }
        await objectStore.deleteObject(key);
      },
    },
  });
  const blobId = crypto.randomUUID();
  const storageKey = `organizations/${ORGANIZATION_ID}/blob-stages/${blobId}`;
  const bytes = "retryable-reclaim-bytes";
  await uploadBlobObject(runtime.blobObjectStore, storageKey, bytes);
  await insertReclaimableBlob({
    blobId,
    byteLength: bytes.length,
    sha256: await sha256Hex(bytes),
    storageKey,
  });

  const expiredStageId = crypto.randomUUID();
  const expiredStageKey = `organizations/${ORGANIZATION_ID}/blob-stages/${expiredStageId}`;
  const { uploadId } = await runtime.blobObjectStore.createMultipartUpload({
    key: expiredStageKey,
  });
  await db.insert(blobStages).values({
    organizationId: ORGANIZATION_ID,
    byteLength: 1,
    expiresAt: new Date("2000-01-01T00:00:00.000Z"),
    id: expiredStageId,
    ownerUserId: crypto.randomUUID(),
    sha256: "expired-stage-digest",
    storageKey: expiredStageKey,
    uploadId,
  });

  const maintenanceError = await runBlobMaintenance(runtime, {
    dereferencedBlobs: { gracePeriodMs: 24 * HOUR_MS },
    expiredStages: { now: new Date("2000-01-02T00:00:00.000Z") },
  }).then(
    () => null,
    (error: unknown) => error,
  );
  expect(maintenanceError).toBeInstanceOf(AggregateError);
  expect(maintenanceError).toMatchObject({
    message: "Blob maintenance failed",
  });
  expect(await readBlobObjectText(runtime.blobObjectStore, storageKey)).toBe(
    bytes,
  );
  const remainingStages = await db
    .select({ id: blobStages.id })
    .from(blobStages)
    .where(eq(blobStages.id, expiredStageId));
  expect(remainingStages).toEqual([]);
  const [pending] = await db
    .select({
      liveStorageKey: blobAuditObjects.liveStorageKey,
      objectDeleteAttemptedAt: blobAuditObjects.objectDeleteAttemptedAt,
      objectDeletedAt: blobAuditObjects.objectDeletedAt,
      prunedAt: blobAuditObjects.prunedAt,
    })
    .from(blobAuditObjects)
    .where(eq(blobAuditObjects.blobId, blobId));
  expect(pending?.liveStorageKey).toBe(storageKey);
  expect(pending?.objectDeleteAttemptedAt).toBeInstanceOf(Date);
  expect(pending?.prunedAt).toBeInstanceOf(Date);
  expect(pending?.objectDeletedAt).toBeNull();

  const second = await reclaimDereferencedBlobs(runtime, {
    gracePeriodMs: 24 * HOUR_MS,
  });
  expect(second.reclaimedCount).toBe(0);
  expect(second.deletedObjectCount).toBeGreaterThanOrEqual(1);
  expect(
    await readBlobObjectText(runtime.blobObjectStore, storageKey),
  ).toBeNull();
  const [completed] = await db
    .select({
      liveStorageKey: blobAuditObjects.liveStorageKey,
      objectDeletedAt: blobAuditObjects.objectDeletedAt,
    })
    .from(blobAuditObjects)
    .where(eq(blobAuditObjects.blobId, blobId));
  expect(completed?.liveStorageKey).toBeNull();
  expect(completed?.objectDeletedAt).toBeInstanceOf(Date);
});

test("a sweep acknowledges an object deleted before its database acknowledgement", async () => {
  const runtime = createServiceTestRuntime();
  const blobId = crypto.randomUUID();
  const storageKey = `organizations/${ORGANIZATION_ID}/blob-stages/${blobId}`;
  const bytes = "deleted-before-acknowledgement";
  await uploadBlobObject(runtime.blobObjectStore, storageKey, bytes);
  await db.insert(blobAuditObjects).values({
    blobId,
    byteLength: bytes.length,
    historicalBytesRetained: false,
    liveStorageKey: storageKey,
    objectDeleteAttemptedAt: new Date(Date.now() - HOUR_MS),
    organizationId: ORGANIZATION_ID,
    prunedAt: new Date(Date.now() - 2 * HOUR_MS),
    retentionMode: "live_only",
    sha256: await sha256Hex(bytes),
  });

  // Simulate the crash window after the object store accepted the delete but
  // before recordBlobObjectDeleted committed its acknowledgement.
  await runtime.blobObjectStore.deleteObject(storageKey);
  expect(
    await readBlobObjectText(runtime.blobObjectStore, storageKey),
  ).toBeNull();

  const summary = await reclaimDereferencedBlobs(runtime, {
    gracePeriodMs: 24 * HOUR_MS,
  });

  expect(summary.reclaimedCount).toBe(0);
  expect(summary.deletedObjectCount).toBeGreaterThanOrEqual(1);
  const [completed] = await db
    .select({
      liveStorageKey: blobAuditObjects.liveStorageKey,
      objectDeleteAttemptedAt: blobAuditObjects.objectDeleteAttemptedAt,
      objectDeletedAt: blobAuditObjects.objectDeletedAt,
    })
    .from(blobAuditObjects)
    .where(eq(blobAuditObjects.blobId, blobId));
  expect(completed?.liveStorageKey).toBeNull();
  expect(completed?.objectDeleteAttemptedAt).toBeInstanceOf(Date);
  expect(completed?.objectDeletedAt).toBeInstanceOf(Date);
});

test("a poison deletion does not starve newly pending object work", async () => {
  const objectStore = createMemoryBlobObjectStore();
  const poisonBlobId = crypto.randomUUID();
  const poisonStorageKey = `organizations/${ORGANIZATION_ID}/blob-stages/${poisonBlobId}`;
  const runtime = createServiceTestRuntime(db, {
    blobObjectStore: {
      ...objectStore,
      async deleteObject(key) {
        if (key === poisonStorageKey) {
          throw new Error("permanent object-store rejection");
        }
        await objectStore.deleteObject(key);
      },
    },
  });
  const poisonBytes = "poison-reclaim-bytes";
  await uploadBlobObject(
    runtime.blobObjectStore,
    poisonStorageKey,
    poisonBytes,
  );
  await insertReclaimableBlob({
    blobId: poisonBlobId,
    byteLength: poisonBytes.length,
    sha256: await sha256Hex(poisonBytes),
    storageKey: poisonStorageKey,
  });

  await expect(
    reclaimDereferencedBlobs(runtime, {
      gracePeriodMs: 24 * HOUR_MS,
      limit: 1,
    }),
  ).rejects.toThrow("permanent object-store rejection");
  await db
    .update(blobAuditObjects)
    .set({ objectDeleteAttemptedAt: new Date(Date.now() - HOUR_MS) })
    .where(eq(blobAuditObjects.blobId, poisonBlobId));

  const healthyBlobId = crypto.randomUUID();
  const healthyStorageKey = `organizations/${ORGANIZATION_ID}/blob-stages/${healthyBlobId}`;
  const healthyBytes = "healthy-reclaim-bytes";
  await uploadBlobObject(
    runtime.blobObjectStore,
    healthyStorageKey,
    healthyBytes,
  );
  await insertReclaimableBlob({
    blobId: healthyBlobId,
    byteLength: healthyBytes.length,
    sha256: await sha256Hex(healthyBytes),
    storageKey: healthyStorageKey,
  });

  await expect(
    reclaimDereferencedBlobs(runtime, {
      gracePeriodMs: 24 * HOUR_MS,
      limit: 1,
    }),
  ).rejects.toThrow("permanent object-store rejection");
  expect(
    await readBlobObjectText(runtime.blobObjectStore, healthyStorageKey),
  ).toBe(healthyBytes);

  const third = await reclaimDereferencedBlobs(runtime, {
    gracePeriodMs: 24 * HOUR_MS,
    limit: 1,
  });
  expect(third.deletedObjectCount).toBe(1);
  expect(
    await readBlobObjectText(runtime.blobObjectStore, healthyStorageKey),
  ).toBeNull();
  expect(
    await readBlobObjectText(runtime.blobObjectStore, poisonStorageKey),
  ).toBe(poisonBytes);
  await db
    .delete(blobAuditObjects)
    .where(eq(blobAuditObjects.blobId, poisonBlobId));
});

test("continuously arriving object work does not starve a due retry", async () => {
  const objectStore = createMemoryBlobObjectStore();
  const poisonBlobId = crypto.randomUUID();
  const poisonStorageKey = `organizations/${ORGANIZATION_ID}/blob-stages/${poisonBlobId}`;
  const runtime = createServiceTestRuntime(db, {
    blobObjectStore: {
      ...objectStore,
      async deleteObject(key) {
        if (key === poisonStorageKey) {
          throw new Error("permanent object-store rejection");
        }
        await objectStore.deleteObject(key);
      },
    },
  });
  const poisonBytes = "retry-must-get-capacity";
  await uploadBlobObject(
    runtime.blobObjectStore,
    poisonStorageKey,
    poisonBytes,
  );
  await insertReclaimableBlob({
    blobId: poisonBlobId,
    byteLength: poisonBytes.length,
    sha256: await sha256Hex(poisonBytes),
    storageKey: poisonStorageKey,
  });
  await expect(
    reclaimDereferencedBlobs(runtime, {
      gracePeriodMs: 24 * HOUR_MS,
      limit: 1,
    }),
  ).rejects.toThrow("permanent object-store rejection");
  await db
    .update(blobAuditObjects)
    .set({ objectDeleteAttemptedAt: new Date(Date.now() - HOUR_MS) })
    .where(eq(blobAuditObjects.blobId, poisonBlobId));

  const newBlobId = crypto.randomUUID();
  const newStorageKey = `organizations/${ORGANIZATION_ID}/blob-stages/${newBlobId}`;
  const newBytes = "new-work-waits-for-due-retry";
  await uploadBlobObject(runtime.blobObjectStore, newStorageKey, newBytes);
  await insertReclaimableBlob({
    blobId: newBlobId,
    byteLength: newBytes.length,
    sha256: await sha256Hex(newBytes),
    storageKey: newStorageKey,
  });

  await expect(
    reclaimDereferencedBlobs(runtime, {
      gracePeriodMs: 24 * HOUR_MS,
      limit: 1,
    }),
  ).rejects.toThrow("permanent object-store rejection");
  expect(
    await readBlobObjectText(runtime.blobObjectStore, poisonStorageKey),
  ).toBe(poisonBytes);
  expect(await readBlobObjectText(runtime.blobObjectStore, newStorageKey)).toBe(
    newBytes,
  );
  await db
    .delete(blobAuditObjects)
    .where(eq(blobAuditObjects.blobId, poisonBlobId));
  await db
    .delete(blobAuditObjects)
    .where(eq(blobAuditObjects.blobId, newBlobId));
});

test("a corrupt reclaim candidate does not block the durable deletion queue", async () => {
  const runtime = createServiceTestRuntime();
  const pendingBlobId = crypto.randomUUID();
  const pendingStorageKey = `organizations/${ORGANIZATION_ID}/blob-stages/${pendingBlobId}`;
  const pendingBytes = "already-pruned-pending-bytes";
  await uploadBlobObject(
    runtime.blobObjectStore,
    pendingStorageKey,
    pendingBytes,
  );
  await db.insert(blobAuditObjects).values({
    blobId: pendingBlobId,
    byteLength: pendingBytes.length,
    historicalBytesRetained: false,
    liveStorageKey: pendingStorageKey,
    organizationId: ORGANIZATION_ID,
    prunedAt: new Date(Date.now() - HOUR_MS),
    retentionMode: "live_only",
    sha256: await sha256Hex(pendingBytes),
  });

  const corruptBlobId = crypto.randomUUID();
  const corruptStorageKey = `organizations/${ORGANIZATION_ID}/blob-stages/${corruptBlobId}`;
  const corruptBytes = "corrupt-audit-metadata-bytes";
  await insertReclaimableBlob({
    blobId: corruptBlobId,
    byteLength: corruptBytes.length,
    sha256: await sha256Hex(corruptBytes),
    storageKey: corruptStorageKey,
  });
  await db
    .update(blobAuditObjects)
    .set({ sha256: "mismatched-audit-digest" })
    .where(eq(blobAuditObjects.blobId, corruptBlobId));

  await expect(
    reclaimDereferencedBlobs(runtime, { gracePeriodMs: 24 * HOUR_MS }),
  ).rejects.toThrow("audit metadata does not match live storage");
  expect(
    await readBlobObjectText(runtime.blobObjectStore, pendingStorageKey),
  ).toBeNull();
  const [completed] = await db
    .select({
      liveStorageKey: blobAuditObjects.liveStorageKey,
      objectDeletedAt: blobAuditObjects.objectDeletedAt,
    })
    .from(blobAuditObjects)
    .where(eq(blobAuditObjects.blobId, pendingBlobId));
  expect(completed?.liveStorageKey).toBeNull();
  expect(completed?.objectDeletedAt).toBeInstanceOf(Date);
  await db.delete(blobs).where(eq(blobs.id, corruptBlobId));
  await db
    .delete(blobAuditObjects)
    .where(eq(blobAuditObjects.blobId, corruptBlobId));
});

test("a corrupt reclaim candidate does not block expired stage cleanup", async () => {
  const runtime = createServiceTestRuntime();
  const corruptBlobId = crypto.randomUUID();
  const corruptStorageKey = `organizations/${ORGANIZATION_ID}/blob-stages/${corruptBlobId}`;
  const corruptBytes = "corrupt-candidate-before-stage-cleanup";
  await insertReclaimableBlob({
    blobId: corruptBlobId,
    byteLength: corruptBytes.length,
    sha256: await sha256Hex(corruptBytes),
    storageKey: corruptStorageKey,
  });
  await db
    .update(blobAuditObjects)
    .set({ sha256: "mismatched-audit-digest" })
    .where(eq(blobAuditObjects.blobId, corruptBlobId));

  const stageId = crypto.randomUUID();
  const stageStorageKey = `organizations/${ORGANIZATION_ID}/blob-stages/${stageId}`;
  const { uploadId } = await runtime.blobObjectStore.createMultipartUpload({
    key: stageStorageKey,
  });
  await db.insert(blobStages).values({
    organizationId: ORGANIZATION_ID,
    byteLength: 1,
    expiresAt: new Date("2000-01-01T00:00:00.000Z"),
    id: stageId,
    ownerUserId: crypto.randomUUID(),
    sha256: "stage-digest",
    storageKey: stageStorageKey,
    uploadId,
  });

  await expect(
    runBlobMaintenance(runtime, {
      dereferencedBlobs: { gracePeriodMs: 24 * HOUR_MS },
      expiredStages: { now: new Date("2000-01-02T00:00:00.000Z") },
    }),
  ).rejects.toThrow("Blob maintenance failed");
  const remainingStages = await db
    .select({ id: blobStages.id })
    .from(blobStages)
    .where(eq(blobStages.id, stageId));
  expect(remainingStages).toEqual([]);
  await db.delete(blobs).where(eq(blobs.id, corruptBlobId));
  await db
    .delete(blobAuditObjects)
    .where(eq(blobAuditObjects.blobId, corruptBlobId));
});
