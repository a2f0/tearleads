import { expect, test } from "bun:test";
import { type ApiDatabase, db } from "@tearleads/api-shared/postgres";
import {
  attachmentBindings,
  blobAuditObjects,
  blobContentKeyEpochs,
  blobs,
} from "@tearleads/api-shared/schema";
import { eq, inArray } from "drizzle-orm";
import { runReclaimDereferencedBlobsWorkflow } from "./reclaimDereferencedBlobs";

const ORGANIZATION_ID = "fd48148f-2bb0-420d-925a-7007d5c1c40f";
const HOUR_MS = 60 * 60 * 1000;
const GRACE_PERIOD_MS = 24 * HOUR_MS;

function storageKeyFor(blobId: string): string {
  return `organizations/${ORGANIZATION_ID}/blob-stages/${blobId}`;
}

async function insertDereferencedBlobs(
  now: Date,
  count: number,
): Promise<string[]> {
  const blobIds = Array.from({ length: count }, () => crypto.randomUUID());
  await db.insert(blobs).values(
    blobIds.map((id, index) => ({
      byteLength: 1,
      // Distinct ages keep the candidate order, and so the order of the
      // per-blob retries, deterministic.
      dereferencedAt: new Date(now.getTime() - 48 * HOUR_MS - index),
      id,
      sha256: `sha256:${id}`,
      storageKey: storageKeyFor(id),
    })),
  );
  await db.insert(blobAuditObjects).values(
    blobIds.map((id) => ({
      blobId: id,
      byteLength: 1,
      historicalBytesRetained: false,
      liveStorageKey: storageKeyFor(id),
      organizationId: ORGANIZATION_ID,
      retentionMode: "live_only" as const,
      sha256: `sha256:${id}`,
    })),
  );
  return blobIds.toReversed();
}

async function existingBlobIds(blobIds: readonly string[]): Promise<string[]> {
  const rows = await db
    .select({ id: blobs.id })
    .from(blobs)
    .where(inArray(blobs.id, [...blobIds]));
  return rows.map((row) => row.id).toSorted();
}

async function cleanupBlobRows(blobIds: readonly string[]): Promise<void> {
  await db.delete(blobs).where(inArray(blobs.id, [...blobIds]));
  await db
    .delete(blobAuditObjects)
    .where(inArray(blobAuditObjects.blobId, [...blobIds]));
  await db
    .delete(attachmentBindings)
    .where(inArray(attachmentBindings.blobId, [...blobIds]));
}

/** Counts transactions and fails the ones whose 1-based ordinal is listed. */
function transactionProbe(failingCalls: ReadonlySet<number> = new Set()): {
  readonly calls: () => number;
  readonly database: ApiDatabase;
} {
  let calls = 0;
  return {
    calls: () => calls,
    database: {
      delete: db.delete.bind(db),
      execute: db.execute.bind(db),
      insert: db.insert.bind(db),
      select: db.select.bind(db),
      transaction: (...args) => {
        calls += 1;
        if (failingCalls.has(calls)) {
          return Promise.reject(new Error(`injected transaction ${calls}`));
        }
        return db.transaction(...args);
      },
      update: db.update.bind(db),
    },
  };
}

test("one chunk revives, reclaims, and fails its candidates independently", async () => {
  const now = new Date();
  const [revivedId, corruptId, firstId, secondId] =
    await insertDereferencedBlobs(now, 4);
  if (!revivedId || !corruptId || !firstId || !secondId) {
    throw new Error("Missing fixture blob");
  }
  const blobIds = [revivedId, corruptId, firstId, secondId];
  await db.insert(attachmentBindings).values([
    {
      blobId: revivedId,
      documentId: crypto.randomUUID(),
      id: crypto.randomUUID(),
      slotId: "slot_chunk_revive",
    },
    {
      blobId: firstId,
      detachedAt: new Date(now.getTime() - 48 * HOUR_MS),
      documentId: crypto.randomUUID(),
      id: crypto.randomUUID(),
      slotId: "slot_chunk_detached",
    },
  ]);
  await db
    .insert(blobContentKeyEpochs)
    .values({ blobId: firstId, contentKeyEpoch: 1, targetHash: "target" });
  await db
    .update(blobAuditObjects)
    .set({ sha256: "mismatched-audit-digest" })
    .where(eq(blobAuditObjects.blobId, corruptId));
  const probe = transactionProbe();

  try {
    await expect(
      runReclaimDereferencedBlobsWorkflow(probe.database, {
        blobIds,
        gracePeriodMs: GRACE_PERIOD_MS,
        now,
      }),
    ).rejects.toThrow(
      `Blob reclamation encountered 1 failure(s): Blob ${corruptId} audit metadata does not match live storage`,
    );

    expect(probe.calls()).toBe(1);
    expect(await existingBlobIds(blobIds)).toEqual(
      [revivedId, corruptId].toSorted(),
    );
    const blobRows = await db
      .select({
        dereferencedAt: blobs.dereferencedAt,
        id: blobs.id,
        reclaimAttemptedAt: blobs.reclaimAttemptedAt,
      })
      .from(blobs)
      .where(inArray(blobs.id, [revivedId, corruptId]));
    expect(blobRows.find((row) => row.id === revivedId)).toMatchObject({
      dereferencedAt: null,
      reclaimAttemptedAt: null,
    });
    expect(blobRows.find((row) => row.id === corruptId)).toMatchObject({
      reclaimAttemptedAt: now,
    });
    const auditRows = await db
      .select({
        blobId: blobAuditObjects.blobId,
        liveStorageKey: blobAuditObjects.liveStorageKey,
        prunedAt: blobAuditObjects.prunedAt,
      })
      .from(blobAuditObjects)
      .where(inArray(blobAuditObjects.blobId, blobIds));
    for (const blobId of [firstId, secondId]) {
      const auditRow = auditRows.find((row) => row.blobId === blobId);
      expect(auditRow?.liveStorageKey).toBe(storageKeyFor(blobId));
      expect(auditRow?.prunedAt).toBeInstanceOf(Date);
    }
    for (const blobId of [revivedId, corruptId]) {
      expect(auditRows.find((row) => row.blobId === blobId)?.prunedAt).toBe(
        null,
      );
    }
    const bindingRows = await db
      .select({ blobId: attachmentBindings.blobId })
      .from(attachmentBindings)
      .where(inArray(attachmentBindings.blobId, blobIds));
    expect(bindingRows).toEqual([{ blobId: revivedId }]);
    expect(
      await db
        .select({ id: blobContentKeyEpochs.id })
        .from(blobContentKeyEpochs)
        .where(eq(blobContentKeyEpochs.blobId, firstId)),
    ).toEqual([]);
  } finally {
    await cleanupBlobRows(blobIds);
  }
});

test("a failed chunk transaction retries each candidate alone", async () => {
  const now = new Date();
  const blobIds = await insertDereferencedBlobs(now, 3);
  const [firstId, failingId, lastId] = blobIds;
  if (!firstId || !failingId || !lastId) {
    throw new Error("Missing fixture blob");
  }
  // The chunk transaction and then the middle candidate's own transaction.
  const probe = transactionProbe(new Set([1, 3]));

  try {
    await expect(
      runReclaimDereferencedBlobsWorkflow(probe.database, {
        blobIds,
        gracePeriodMs: GRACE_PERIOD_MS,
        now,
      }),
    ).rejects.toThrow(
      "Blob reclamation encountered 1 failure(s): injected transaction 3",
    );

    expect(probe.calls()).toBe(4);
    expect(await existingBlobIds(blobIds)).toEqual([failingId]);
    const [deferred] = await db
      .select({ reclaimAttemptedAt: blobs.reclaimAttemptedAt })
      .from(blobs)
      .where(eq(blobs.id, failingId));
    expect(deferred?.reclaimAttemptedAt).toEqual(now);
  } finally {
    await cleanupBlobRows(blobIds);
  }
});

test("a chunk failure the per-blob retries absorb is not reported", async () => {
  const now = new Date();
  const blobIds = await insertDereferencedBlobs(now, 2);
  const probe = transactionProbe(new Set([1]));

  try {
    const result = await runReclaimDereferencedBlobsWorkflow(probe.database, {
      blobIds,
      gracePeriodMs: GRACE_PERIOD_MS,
      now,
    });

    expect(result).toEqual({ reclaimedBlobIds: blobIds, revivedBlobIds: [] });
    expect(probe.calls()).toBe(3);
    expect(await existingBlobIds(blobIds)).toEqual([]);
  } finally {
    await cleanupBlobRows(blobIds);
  }
});
