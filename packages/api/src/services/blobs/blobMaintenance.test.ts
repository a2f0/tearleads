import { expect, test } from "bun:test";
import { db } from "@symcrypt/api-shared/postgres";
import { blobAuditObjects, blobs } from "@symcrypt/api-shared/schema";
import { eq } from "drizzle-orm";
import {
  readBlobObjectText,
  uploadBlobObject,
} from "../../../test/helpers/blobObjectStore";
import { createServiceTestRuntime } from "../../../test/helpers/serviceRuntime";
import { createMemoryBlobObjectStore } from "../../adapters/blobObjectStore";
import { sha256Hex } from "../../utils/sha256";
import { reclaimDereferencedBlobs } from "./blobMaintenance";

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
    retentionMode: "live_only",
    sha256: input.sha256,
  });
}

test("reclaimDereferencedBlobs deletes the reclaimed object-store bytes after commit", async () => {
  const runtime = createServiceTestRuntime();
  const blobId = crypto.randomUUID();
  const storageKey = `blob-object:${blobId}`;
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
  const storageKey = `blob-object:${blobId}`;
  const bytes = "retryable-reclaim-bytes";
  await uploadBlobObject(runtime.blobObjectStore, storageKey, bytes);
  await insertReclaimableBlob({
    blobId,
    byteLength: bytes.length,
    sha256: await sha256Hex(bytes),
    storageKey,
  });

  const first = await reclaimDereferencedBlobs(runtime, {
    gracePeriodMs: 24 * HOUR_MS,
  });
  expect(first.failedObjectDeletions).toBeGreaterThanOrEqual(1);
  expect(await readBlobObjectText(runtime.blobObjectStore, storageKey)).toBe(
    bytes,
  );
  const [pending] = await db
    .select({
      liveStorageKey: blobAuditObjects.liveStorageKey,
      objectDeletedAt: blobAuditObjects.objectDeletedAt,
      prunedAt: blobAuditObjects.prunedAt,
    })
    .from(blobAuditObjects)
    .where(eq(blobAuditObjects.blobId, blobId));
  expect(pending?.liveStorageKey).toBe(storageKey);
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
