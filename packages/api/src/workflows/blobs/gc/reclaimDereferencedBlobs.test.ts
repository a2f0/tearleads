const ORGANIZATION_ID = "fd48148f-2bb0-420d-925a-7007d5c1c40f";

import { expect, test } from "bun:test";
import { db } from "@tearleads/api-shared/postgres";
import {
  attachmentBindings,
  blobAuditObjects,
  blobContentKeyEpochs,
  blobs,
} from "@tearleads/api-shared/schema";
import { eq } from "drizzle-orm";
import { runReclaimDereferencedBlobsWorkflow } from "./reclaimDereferencedBlobs";

const HOUR_MS = 60 * 60 * 1000;

async function insertDereferencedBlob(input: {
  readonly id: string;
  readonly dereferencedAt: Date;
  readonly storageKey?: string;
}): Promise<void> {
  const storageKey =
    input.storageKey ??
    `organizations/${ORGANIZATION_ID}/blob-stages/${input.id}`;
  await db.insert(blobs).values({
    id: input.id,
    storageKey,
    sha256: `sha256:${input.id}`,
    byteLength: 1,
    dereferencedAt: input.dereferencedAt,
  });
  await db.insert(blobAuditObjects).values({
    blobId: input.id,
    byteLength: 1,
    historicalBytesRetained: false,
    liveStorageKey: storageKey,
    organizationId: ORGANIZATION_ID,
    retentionMode: "live_only",
    sha256: `sha256:${input.id}`,
  });
}

async function blobExists(id: string): Promise<boolean> {
  const rows = await db
    .select({ id: blobs.id })
    .from(blobs)
    .where(eq(blobs.id, id));
  return rows.length > 0;
}

test("reclaims an unreferenced blob dereferenced past the grace period", async () => {
  const blobId = crypto.randomUUID();
  await insertDereferencedBlob({
    id: blobId,
    dereferencedAt: new Date(Date.now() - 48 * HOUR_MS),
  });

  const result = await runReclaimDereferencedBlobsWorkflow(db, {
    gracePeriodMs: 24 * HOUR_MS,
  });

  expect(result.reclaimedBlobIds).toContain(blobId);
  expect(await blobExists(blobId)).toBe(false);
  const [auditObject] = await db
    .select({
      liveStorageKey: blobAuditObjects.liveStorageKey,
      objectDeletedAt: blobAuditObjects.objectDeletedAt,
      prunedAt: blobAuditObjects.prunedAt,
    })
    .from(blobAuditObjects)
    .where(eq(blobAuditObjects.blobId, blobId));
  expect(auditObject?.liveStorageKey).toBe(
    `organizations/${ORGANIZATION_ID}/blob-stages/${blobId}`,
  );
  expect(auditObject?.objectDeletedAt).toBeNull();
  expect(auditObject?.prunedAt).toBeInstanceOf(Date);
});

test("does not reclaim a blob still within the grace period", async () => {
  const blobId = crypto.randomUUID();
  await insertDereferencedBlob({
    id: blobId,
    dereferencedAt: new Date(Date.now() - 1 * HOUR_MS),
  });

  const result = await runReclaimDereferencedBlobsWorkflow(db, {
    gracePeriodMs: 24 * HOUR_MS,
  });

  expect(result.reclaimedBlobIds).not.toContain(blobId);
  expect(await blobExists(blobId)).toBe(true);
});

test("fails closed when required audit deletion state is missing", async () => {
  const blobId = crypto.randomUUID();
  await db.insert(blobs).values({
    byteLength: 1,
    dereferencedAt: new Date(Date.now() - 48 * HOUR_MS),
    id: blobId,
    sha256: `sha256:${blobId}`,
    storageKey: `organizations/${ORGANIZATION_ID}/blob-stages/${blobId}`,
  });

  await expect(
    runReclaimDereferencedBlobsWorkflow(db, {
      gracePeriodMs: 24 * HOUR_MS,
    }),
  ).rejects.toThrow("audit metadata does not match live storage");
  expect(await blobExists(blobId)).toBe(true);
  await db.delete(blobs).where(eq(blobs.id, blobId));
});

test("a corrupt first candidate does not block later healthy reclamation", async () => {
  const corruptBlobId = crypto.randomUUID();
  const healthyBlobId = crypto.randomUUID();
  await insertDereferencedBlob({
    dereferencedAt: new Date(Date.now() - 49 * HOUR_MS),
    id: corruptBlobId,
  });
  await db
    .update(blobAuditObjects)
    .set({ sha256: "mismatched-audit-digest" })
    .where(eq(blobAuditObjects.blobId, corruptBlobId));
  await insertDereferencedBlob({
    dereferencedAt: new Date(Date.now() - 48 * HOUR_MS),
    id: healthyBlobId,
  });

  await expect(
    runReclaimDereferencedBlobsWorkflow(db, {
      gracePeriodMs: 24 * HOUR_MS,
    }),
  ).rejects.toThrow("audit metadata does not match live storage");
  expect(await blobExists(corruptBlobId)).toBe(true);
  expect(await blobExists(healthyBlobId)).toBe(false);
  const [healthyAudit] = await db
    .select({ prunedAt: blobAuditObjects.prunedAt })
    .from(blobAuditObjects)
    .where(eq(blobAuditObjects.blobId, healthyBlobId));
  expect(healthyAudit?.prunedAt).toBeInstanceOf(Date);
  await db.delete(blobs).where(eq(blobs.id, corruptBlobId));
  await db
    .delete(blobAuditObjects)
    .where(eq(blobAuditObjects.blobId, corruptBlobId));
});

test("a corrupt bounded candidate rotates behind healthy work", async () => {
  const now = new Date();
  const corruptBlobId = crypto.randomUUID();
  const healthyBlobId = crypto.randomUUID();
  const corruptDereferencedAt = new Date(now.getTime() - 49 * HOUR_MS);
  await insertDereferencedBlob({
    dereferencedAt: corruptDereferencedAt,
    id: corruptBlobId,
  });
  await db
    .update(blobAuditObjects)
    .set({ sha256: "mismatched-audit-digest" })
    .where(eq(blobAuditObjects.blobId, corruptBlobId));
  await insertDereferencedBlob({
    dereferencedAt: new Date(now.getTime() - 48 * HOUR_MS),
    id: healthyBlobId,
  });

  await expect(
    runReclaimDereferencedBlobsWorkflow(db, {
      gracePeriodMs: 24 * HOUR_MS,
      limit: 1,
      now,
    }),
  ).rejects.toThrow("audit metadata does not match live storage");
  const [rotated] = await db
    .select({
      dereferencedAt: blobs.dereferencedAt,
      reclaimAttemptedAt: blobs.reclaimAttemptedAt,
    })
    .from(blobs)
    .where(eq(blobs.id, corruptBlobId));
  expect(rotated?.dereferencedAt).toEqual(corruptDereferencedAt);
  expect(rotated?.reclaimAttemptedAt).toEqual(now);

  const result = await runReclaimDereferencedBlobsWorkflow(db, {
    gracePeriodMs: 24 * HOUR_MS,
    limit: 1,
    now,
  });
  expect(result.reclaimedBlobIds).toEqual([healthyBlobId]);
  expect(await blobExists(corruptBlobId)).toBe(true);
  await db.delete(blobs).where(eq(blobs.id, corruptBlobId));
  await db
    .delete(blobAuditObjects)
    .where(eq(blobAuditObjects.blobId, corruptBlobId));
});

test("revives a dereferenced blob that a binding re-references", async () => {
  const blobId = crypto.randomUUID();
  await insertDereferencedBlob({
    id: blobId,
    dereferencedAt: new Date(Date.now() - 48 * HOUR_MS),
  });
  // A bind re-referenced the blob after purge soft-deleted it.
  await db.insert(attachmentBindings).values({
    id: crypto.randomUUID(),
    documentId: crypto.randomUUID(),
    slotId: "slot_revive",
    blobId,
  });

  const result = await runReclaimDereferencedBlobsWorkflow(db, {
    gracePeriodMs: 24 * HOUR_MS,
  });

  expect(result.revivedBlobIds).toContain(blobId);
  expect(result.reclaimedBlobIds).not.toContain(blobId);
  const [row] = await db
    .select({ dereferencedAt: blobs.dereferencedAt })
    .from(blobs)
    .where(eq(blobs.id, blobId));
  expect(row?.dereferencedAt).toBeNull();
});

test("detached bindings preserve audit history without keeping bytes live", async () => {
  const blobId = crypto.randomUUID();
  await insertDereferencedBlob({
    id: blobId,
    dereferencedAt: new Date(Date.now() - 48 * HOUR_MS),
  });
  await db.insert(attachmentBindings).values({
    id: crypto.randomUUID(),
    documentId: crypto.randomUUID(),
    slotId: "slot_detached_history",
    blobId,
    detachedAt: new Date(Date.now() - 48 * HOUR_MS),
  });

  const result = await runReclaimDereferencedBlobsWorkflow(db, {
    gracePeriodMs: 24 * HOUR_MS,
  });

  expect(result.reclaimedBlobIds).toContain(blobId);
  expect(await blobExists(blobId)).toBe(false);
  const bindings = await db
    .select({ id: attachmentBindings.id })
    .from(attachmentBindings)
    .where(eq(attachmentBindings.blobId, blobId));
  expect(bindings).toHaveLength(0);
  const [auditObject] = await db
    .select({ blobId: blobAuditObjects.blobId })
    .from(blobAuditObjects)
    .where(eq(blobAuditObjects.blobId, blobId));
  expect(auditObject?.blobId).toBe(blobId);
});

test("reclaims a blob's content-key epoch rows", async () => {
  const blobId = crypto.randomUUID();
  await insertDereferencedBlob({
    id: blobId,
    dereferencedAt: new Date(Date.now() - 48 * HOUR_MS),
  });
  await db.insert(blobContentKeyEpochs).values({
    blobId,
    contentKeyEpoch: 1,
    targetHash: `target:${blobId}`,
  });

  await runReclaimDereferencedBlobsWorkflow(db, {
    gracePeriodMs: 24 * HOUR_MS,
  });

  const epochRows = await db
    .select({ id: blobContentKeyEpochs.id })
    .from(blobContentKeyEpochs)
    .where(eq(blobContentKeyEpochs.blobId, blobId));
  expect(epochRows).toHaveLength(0);
});
