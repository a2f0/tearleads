import { expect, setSystemTime, test } from "bun:test";
import { db, getDefaultApiDatabaseKind } from "@symcrypt/api-shared/postgres";
import {
  attachmentBindings,
  blobAuditObjects,
  blobContentKeyEpochs,
  blobs,
} from "@symcrypt/api-shared/schema";
import { eq, sql } from "drizzle-orm";
import { lockBlobMutationRows } from "../mutations/blobMutationLocks";
import {
  deferFailedBlobReclaim,
  runReclaimDereferencedBlobsWorkflow,
} from "./reclaimDereferencedBlobs";

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
  await db.insert(blobAuditObjects).values({
    blobId: input.id,
    byteLength: 1,
    historicalBytesRetained: false,
    liveStorageKey: storageKey,
    organizationId: crypto.randomUUID(),
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
  expect(auditObject?.liveStorageKey).toBe(`blob-object:${blobId}`);
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

test.skipIf(getDefaultApiDatabaseKind() !== "postgres")(
  "uses the database clock for the default cutoff under API host skew",
  async () => {
    const actualNow = new Date();
    const blobId = crypto.randomUUID();
    await insertDereferencedBlob({
      id: blobId,
      dereferencedAt: actualNow,
    });

    setSystemTime(new Date(actualNow.getTime() + 48 * HOUR_MS));
    try {
      const result = await runReclaimDereferencedBlobsWorkflow(db, {
        gracePeriodMs: 24 * HOUR_MS,
      });

      expect(result.reclaimedBlobIds).not.toContain(blobId);
      expect(await blobExists(blobId)).toBe(true);
    } finally {
      setSystemTime();
      await db.delete(blobs).where(eq(blobs.id, blobId));
      await db
        .delete(blobAuditObjects)
        .where(eq(blobAuditObjects.blobId, blobId));
    }
  },
);

test("fails closed when required audit deletion state is missing", async () => {
  const blobId = crypto.randomUUID();
  await db.insert(blobs).values({
    byteLength: 1,
    dereferencedAt: new Date(Date.now() - 48 * HOUR_MS),
    id: blobId,
    sha256: `sha256:${blobId}`,
    storageKey: `blob-object:${blobId}`,
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

test.skipIf(getDefaultApiDatabaseKind() !== "postgres")(
  "a PostgreSQL timestamp with microseconds rotates after reclaim failure",
  async () => {
    const retryAt = new Date();
    const blobId = crypto.randomUUID();
    await insertDereferencedBlob({
      dereferencedAt: new Date(retryAt.getTime() - 49 * HOUR_MS),
      id: blobId,
    });
    await db
      .update(blobs)
      .set({ dereferencedAt: sql`now() - interval '49 hours'` })
      .where(eq(blobs.id, blobId));
    const [before] = await db
      .select({ dereferencedAt: blobs.dereferencedAt })
      .from(blobs)
      .where(eq(blobs.id, blobId));
    await db
      .update(blobAuditObjects)
      .set({ sha256: "mismatched-audit-digest" })
      .where(eq(blobAuditObjects.blobId, blobId));

    await expect(
      runReclaimDereferencedBlobsWorkflow(db, {
        gracePeriodMs: 24 * HOUR_MS,
        limit: 1,
        now: retryAt,
      }),
    ).rejects.toThrow("audit metadata does not match live storage");
    const [rotated] = await db
      .select({
        dereferencedAt: blobs.dereferencedAt,
        reclaimAttemptedAt: blobs.reclaimAttemptedAt,
      })
      .from(blobs)
      .where(eq(blobs.id, blobId));
    expect(rotated?.dereferencedAt).toEqual(before?.dereferencedAt);
    expect(rotated?.reclaimAttemptedAt).toEqual(retryAt);
    await db.delete(blobs).where(eq(blobs.id, blobId));
    await db
      .delete(blobAuditObjects)
      .where(eq(blobAuditObjects.blobId, blobId));
  },
  30_000,
);

test.skipIf(getDefaultApiDatabaseKind() !== "postgres")(
  "a late overlapping sweep cannot move a newer retry marker backward",
  async () => {
    const blobId = crypto.randomUUID();
    const olderSweepAt = new Date("2026-08-22T00:00:00.000Z");
    const newerSweepAt = new Date("2026-08-22T01:00:00.000Z");
    const dereferencedAt = new Date("2026-08-20T00:00:00.000Z");
    await insertDereferencedBlob({ dereferencedAt, id: blobId });

    let releaseOlderSweep!: () => void;
    const olderSweepDelay = new Promise<void>((resolve) => {
      releaseOlderSweep = resolve;
    });
    const olderSweep = (async () => {
      await olderSweepDelay;
      await deferFailedBlobReclaim(db, {
        blobId,
        cutoff: olderSweepAt,
        retryAt: olderSweepAt,
      });
    })();

    try {
      await deferFailedBlobReclaim(db, {
        blobId,
        cutoff: newerSweepAt,
        retryAt: newerSweepAt,
      });
      releaseOlderSweep();
      await olderSweep;

      const [row] = await db
        .select({ reclaimAttemptedAt: blobs.reclaimAttemptedAt })
        .from(blobs)
        .where(eq(blobs.id, blobId));
      expect(row?.reclaimAttemptedAt).toEqual(newerSweepAt);
    } finally {
      releaseOlderSweep();
      await olderSweep.catch(() => undefined);
      await db.delete(blobs).where(eq(blobs.id, blobId));
      await db
        .delete(blobAuditObjects)
        .where(eq(blobAuditObjects.blobId, blobId));
    }
  },
  30_000,
);

test.skipIf(getDefaultApiDatabaseKind() !== "postgres")(
  "a fresh re-detach after selection restarts the grace period",
  async () => {
    const now = new Date();
    const blobId = crypto.randomUUID();
    await insertDereferencedBlob({
      dereferencedAt: new Date(now.getTime() - 48 * HOUR_MS),
      id: blobId,
    });

    let markHeld!: () => void;
    const held = new Promise<void>((resolve) => {
      markHeld = resolve;
    });
    let releaseHold!: () => void;
    const hold = new Promise<void>((resolve) => {
      releaseHold = resolve;
    });
    const holder = db.transaction(async (tx) => {
      await lockBlobMutationRows({ blobIds: [blobId], executor: tx });
      markHeld();
      await hold;
      await tx
        .update(blobs)
        .set({ dereferencedAt: now })
        .where(eq(blobs.id, blobId));
    });

    await held;
    let reclaimSettled = false;
    const reclaim = runReclaimDereferencedBlobsWorkflow(db, {
      gracePeriodMs: 24 * HOUR_MS,
      now,
    }).then((result) => {
      reclaimSettled = true;
      return result;
    });
    await new Promise((resolve) => setTimeout(resolve, 300));
    const settledWhileHeld = reclaimSettled;
    releaseHold();
    const [, result] = await Promise.all([holder, reclaim]);

    expect(settledWhileHeld).toBe(false);
    expect(result.reclaimedBlobIds).not.toContain(blobId);
    expect(await blobExists(blobId)).toBe(true);
    await db.delete(blobs).where(eq(blobs.id, blobId));
    await db
      .delete(blobAuditObjects)
      .where(eq(blobAuditObjects.blobId, blobId));
  },
  30_000,
);

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
