import { expect, test } from "bun:test";
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
import { sha256Hex } from "../../utils/sha256";
import { reclaimDereferencedBlobs } from "./blobMaintenance";
import { cleanupExpiredBlobStages } from "./multipartStage";

test("GC keeps a mismatched organization key queued without deleting the foreign object", async () => {
  const runtime = createServiceTestRuntime();
  const organizationId = crypto.randomUUID();
  const foreignId = crypto.randomUUID();
  const blobId = crypto.randomUUID();
  const key = `organizations/${foreignId}/blob-stages/${crypto.randomUUID()}`;
  await uploadBlobObject(runtime.blobObjectStore, key, "foreign bytes");
  await runtime.db.insert(blobAuditObjects).values({
    blobId,
    organizationId,
    liveStorageKey: key,
    byteLength: 13,
    sha256: sha256Hex("foreign bytes"),
    historicalBytesRetained: false,
    retentionMode: "live_only",
    prunedAt: new Date(0),
  });
  try {
    await expect(
      reclaimDereferencedBlobs(runtime, { blobIds: [blobId] }),
    ).rejects.toThrow();
    const [pending] = await runtime.db
      .select()
      .from(blobAuditObjects)
      .where(eq(blobAuditObjects.blobId, blobId));
    expect(pending?.objectDeleteAttemptedAt).toBeInstanceOf(Date);
    expect(pending?.objectDeletedAt).toBeNull();
    expect(pending?.liveStorageKey).toBe(key);
    expect(await readBlobObjectText(runtime.blobObjectStore, key)).toBe(
      "foreign bytes",
    );
  } finally {
    await runtime.db
      .delete(blobAuditObjects)
      .where(eq(blobAuditObjects.blobId, blobId));
  }
});

test("reclamation refuses a live blob whose key belongs to another organization", async () => {
  const runtime = createServiceTestRuntime();
  const blobId = crypto.randomUUID();
  const storageKey = `organizations/${crypto.randomUUID()}/blob-stages/${crypto.randomUUID()}`;
  const metadata = { byteLength: 13, sha256: sha256Hex("foreign bytes") };
  await runtime.db.insert(blobs).values({
    ...metadata,
    id: blobId,
    storageKey,
    dereferencedAt: new Date(0),
  });
  await runtime.db.insert(blobAuditObjects).values({
    ...metadata,
    blobId,
    organizationId: crypto.randomUUID(),
    liveStorageKey: storageKey,
    historicalBytesRetained: false,
    retentionMode: "live_only",
  });
  try {
    await expect(
      reclaimDereferencedBlobs(runtime, {
        blobIds: [blobId],
        gracePeriodMs: 0,
      }),
    ).rejects.toThrow();
    const [live] = await runtime.db
      .select()
      .from(blobs)
      .where(eq(blobs.id, blobId));
    expect(live?.storageKey).toBe(storageKey);
    expect(live?.reclaimAttemptedAt).toBeInstanceOf(Date);
  } finally {
    await runtime.db.delete(blobs).where(eq(blobs.id, blobId));
    await runtime.db
      .delete(blobAuditObjects)
      .where(eq(blobAuditObjects.blobId, blobId));
  }
});

test("expired-stage cleanup refuses an object key outside the stage organization", async () => {
  const runtime = createServiceTestRuntime();
  const stageId = crypto.randomUUID();
  const storageKey = `organizations/${crypto.randomUUID()}/blob-stages/${stageId}`;
  await uploadBlobObject(runtime.blobObjectStore, storageKey, "foreign bytes");
  await runtime.db.insert(blobStages).values({
    id: stageId,
    organizationId: crypto.randomUUID(),
    storageKey,
    ownerUserId: crypto.randomUUID(),
    uploadId: "consumed-upload",
    byteLength: 13,
    sha256: sha256Hex("foreign bytes"),
    completedAt: new Date(0),
    expiresAt: new Date(0),
  });
  try {
    const summary = await cleanupExpiredBlobStages(runtime, {
      now: new Date(1),
    });
    expect(summary).toMatchObject({
      failedStages: 1,
      deletedStages: 0,
      deletedMultipartObjects: 0,
    });
    expect(await readBlobObjectText(runtime.blobObjectStore, storageKey)).toBe(
      "foreign bytes",
    );
  } finally {
    await runtime.db.delete(blobStages).where(eq(blobStages.id, stageId));
  }
});
