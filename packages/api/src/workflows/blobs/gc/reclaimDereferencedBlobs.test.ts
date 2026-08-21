import { expect, test } from "bun:test";
import { db } from "@symcrypt/api-shared/postgres";
import {
  attachmentBindings,
  blobContentKeyEpochs,
  blobs,
} from "@symcrypt/api-shared/schema";
import { eq } from "drizzle-orm";
import { runReclaimDereferencedBlobsWorkflow } from "./reclaimDereferencedBlobs";

const HOUR_MS = 60 * 60 * 1000;

async function insertDereferencedBlob(input: {
  readonly id: string;
  readonly dereferencedAt: Date;
  readonly storageKey?: string;
}): Promise<void> {
  const storageKey = input.storageKey ?? `blob-object:${input.id}`;
  await db.insert(blobs).values({
    id: input.id,
    storageKey,
    sha256: `sha256:${input.id}`,
    byteLength: 1,
    dereferencedAt: input.dereferencedAt,
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
