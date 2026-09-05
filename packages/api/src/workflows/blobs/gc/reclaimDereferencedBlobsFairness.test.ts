import { expect, test } from "bun:test";
import { db } from "@tearleads/api-shared/postgres";
import { blobAuditObjects, blobs } from "@tearleads/api-shared/schema";
import { eq, inArray } from "drizzle-orm";
import { runReclaimDereferencedBlobsWorkflow } from "./reclaimDereferencedBlobs";

const ORGANIZATION_ID = "fd48148f-2bb0-420d-925a-7007d5c1c40f";

const HOUR_MS = 60 * 60 * 1000;
const GRACE_PERIOD_MS = 24 * HOUR_MS;

async function insertDereferencedBlob(input: {
  readonly dereferencedAt: Date;
  readonly id: string;
}): Promise<void> {
  const storageKey = `organizations/${ORGANIZATION_ID}/blob-stages/${input.id}`;
  await db.insert(blobs).values({
    byteLength: 1,
    dereferencedAt: input.dereferencedAt,
    id: input.id,
    sha256: `sha256:${input.id}`,
    storageKey,
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

async function makeReclaimFail(blobId: string): Promise<void> {
  await db
    .update(blobAuditObjects)
    .set({ sha256: "mismatched-audit-digest" })
    .where(eq(blobAuditObjects.blobId, blobId));
}

async function repairReclaim(blobId: string): Promise<void> {
  await db
    .update(blobAuditObjects)
    .set({ sha256: `sha256:${blobId}` })
    .where(eq(blobAuditObjects.blobId, blobId));
}

async function cleanupBlobRows(blobIds: readonly string[]): Promise<void> {
  await db.delete(blobs).where(inArray(blobs.id, [...blobIds]));
  await db
    .delete(blobAuditObjects)
    .where(inArray(blobAuditObjects.blobId, [...blobIds]));
}

test("a repaired retry receives reserved capacity beside new reclaim work", async () => {
  const firstNow = new Date("2026-08-22T00:00:00.000Z");
  const retryBlobId = crypto.randomUUID();
  await insertDereferencedBlob({
    dereferencedAt: new Date(firstNow.getTime() - 49 * HOUR_MS),
    id: retryBlobId,
  });
  await makeReclaimFail(retryBlobId);
  await expect(
    runReclaimDereferencedBlobsWorkflow(db, {
      gracePeriodMs: GRACE_PERIOD_MS,
      limit: 1,
      now: firstNow,
    }),
  ).rejects.toThrow("audit metadata does not match live storage");
  await repairReclaim(retryBlobId);

  const secondNow = new Date(firstNow.getTime() + HOUR_MS);
  const newBlobIds = [crypto.randomUUID(), crypto.randomUUID()];
  for (const id of newBlobIds) {
    await insertDereferencedBlob({
      dereferencedAt: new Date(secondNow.getTime() - GRACE_PERIOD_MS),
      id,
    });
  }

  const result = await runReclaimDereferencedBlobsWorkflow(db, {
    gracePeriodMs: GRACE_PERIOD_MS,
    limit: 2,
    now: secondNow,
  });

  expect(result.reclaimedBlobIds).toContain(retryBlobId);
  expect(result.reclaimedBlobIds).toHaveLength(2);
  const remainingNewRows = await db
    .select({ id: blobs.id })
    .from(blobs)
    .where(inArray(blobs.id, newBlobIds));
  expect(remainingNewRows).toHaveLength(1);
  await cleanupBlobRows(newBlobIds);
});

test("single-slot reclaim alternates retry and continuously arriving work", async () => {
  const firstNow = new Date("2026-08-22T00:00:00.000Z");
  const retryBlobId = crypto.randomUUID();
  await insertDereferencedBlob({
    dereferencedAt: new Date(firstNow.getTime() - 49 * HOUR_MS),
    id: retryBlobId,
  });
  await makeReclaimFail(retryBlobId);
  await expect(
    runReclaimDereferencedBlobsWorkflow(db, {
      gracePeriodMs: GRACE_PERIOD_MS,
      limit: 1,
      now: firstNow,
    }),
  ).rejects.toThrow("audit metadata does not match live storage");

  const firstArrivalNow = new Date(firstNow.getTime() + HOUR_MS);
  const firstArrivalId = crypto.randomUUID();
  await insertDereferencedBlob({
    dereferencedAt: new Date(firstArrivalNow.getTime() - GRACE_PERIOD_MS),
    id: firstArrivalId,
  });
  await expect(
    runReclaimDereferencedBlobsWorkflow(db, {
      gracePeriodMs: GRACE_PERIOD_MS,
      limit: 1,
      now: firstArrivalNow,
    }),
  ).rejects.toThrow("audit metadata does not match live storage");

  const secondArrivalNow = new Date(firstArrivalNow.getTime() + HOUR_MS);
  const secondArrivalId = crypto.randomUUID();
  await insertDereferencedBlob({
    dereferencedAt: new Date(secondArrivalNow.getTime() - GRACE_PERIOD_MS),
    id: secondArrivalId,
  });
  const newWorkResult = await runReclaimDereferencedBlobsWorkflow(db, {
    gracePeriodMs: GRACE_PERIOD_MS,
    limit: 1,
    now: secondArrivalNow,
  });
  expect(newWorkResult.reclaimedBlobIds).toEqual([firstArrivalId]);

  await repairReclaim(retryBlobId);
  const thirdArrivalNow = new Date(secondArrivalNow.getTime() + HOUR_MS);
  const thirdArrivalId = crypto.randomUUID();
  await insertDereferencedBlob({
    dereferencedAt: new Date(thirdArrivalNow.getTime() - GRACE_PERIOD_MS),
    id: thirdArrivalId,
  });
  const retryResult = await runReclaimDereferencedBlobsWorkflow(db, {
    gracePeriodMs: GRACE_PERIOD_MS,
    limit: 1,
    now: thirdArrivalNow,
  });
  expect(retryResult.reclaimedBlobIds).toEqual([retryBlobId]);
  await cleanupBlobRows([secondArrivalId, thirdArrivalId]);
});
