import { expect, test } from "bun:test";
import { createDefaultManagedApiDatabase } from "@tearleads/api-shared/postgres";
import {
  attachmentBindings,
  blobAuditObjects,
  blobs,
} from "@tearleads/api-shared/schema";
import { eq, sql } from "drizzle-orm";
import { seedPendingBlobDeletion } from "../../../test/helpers/pendingBlobDeletion";
import { createServiceTestRuntime } from "../../../test/helpers/serviceRuntime";
import { wallClockNowExpression } from "../../utils/postgresSql";
import { DEFAULT_BLOB_GC_GRACE_PERIOD_MS } from "../../workflows/blobs/gc/gracePeriod";
import {
  recordBlobObjectDeleted,
  recordBlobObjectDeletionAttempt,
} from "../../workflows/blobs/gc/pendingBlobObjectDeletion";
import { runReclaimDereferencedBlobsWorkflow } from "../../workflows/blobs/gc/reclaimDereferencedBlobs";
import { listRootPendingBlobDeletions } from "./pendingDeletions";

const GRACE = DEFAULT_BLOB_GC_GRACE_PERIOD_MS;

test("queue follows grace, reclamation and durable physical deletion without exposing storage metadata", async () => {
  const managed = createDefaultManagedApiDatabase({ API_DATABASE: "memory" });
  try {
    await managed.migrate();
    const db = managed.db;
    const runtime = createServiceTestRuntime(db);
    const organizationId = crypto.randomUUID();
    const recent = await seedPendingBlobDeletion(db, organizationId);
    const old = await seedPendingBlobDeletion(db, organizationId, {
      ageMs: 2 * GRACE,
    });
    await db
      .update(blobs)
      .set({ reclaimAttemptedAt: wallClockNowExpression() })
      .where(eq(blobs.id, old.blobId));
    const beforeRows = await db.select().from(blobAuditObjects);
    const initial = await listRootPendingBlobDeletions(runtime, {
      organizationId,
    });
    expect(initial.nextAfterId).toBeNull();
    expect(initial.blobs).toHaveLength(2);
    expect(initial.blobs.find((row) => row.blobId === recent.blobId)).toEqual({
      blobId: recent.blobId,
      organizationId,
      byteLength: recent.byteLength,
      status: "grace-period",
      dereferencedAt: recent.dereferencedAt.toISOString(),
      eligibleAfter: new Date(
        recent.dereferencedAt.getTime() + GRACE,
      ).toISOString(),
      reclaimAttemptedAt: null,
      prunedAt: null,
      objectDeleteAttemptedAt: null,
    });
    expect(
      initial.blobs.find((row) => row.blobId === old.blobId),
    ).toMatchObject({
      status: "eligible",
      reclaimAttemptedAt: expect.any(String),
    });
    expect(JSON.stringify(initial)).not.toContain(old.storageKey);
    expect(JSON.stringify(initial)).not.toContain("sha256");
    expect(await db.select().from(blobAuditObjects)).toEqual(beforeRows);
    // Use GC's default grace, not a test override, to prove the display and GC agree.
    const reclaimed = await runReclaimDereferencedBlobsWorkflow(db, {
      blobIds: [recent.blobId, old.blobId],
    });
    expect(reclaimed.reclaimedBlobIds).toEqual([old.blobId]);
    const pending = await listRootPendingBlobDeletions(runtime, {
      organizationId,
    });
    expect(pending.blobs.find((row) => row.blobId === old.blobId)).toEqual({
      blobId: old.blobId,
      organizationId,
      byteLength: old.byteLength,
      status: "deletion-pending",
      dereferencedAt: null,
      eligibleAfter: null,
      reclaimAttemptedAt: null,
      prunedAt: expect.any(String),
      objectDeleteAttemptedAt: null,
    });
    const deletion = {
      blobId: old.blobId,
      organizationId,
      storageKey: old.storageKey,
    };
    expect(await recordBlobObjectDeletionAttempt(db, deletion)).toBe(true);
    expect(
      (
        await listRootPendingBlobDeletions(runtime, { organizationId })
      ).blobs.find((row) => row.blobId === old.blobId)?.objectDeleteAttemptedAt,
    ).toEqual(expect.any(String));
    await recordBlobObjectDeleted(db, deletion);
    expect(
      (
        await listRootPendingBlobDeletions(runtime, { organizationId })
      ).blobs.map((row) => row.blobId),
    ).toEqual([recent.blobId]);
  } finally {
    await managed.close();
  }
});

test("active bindings, revived rows, physically deleted records and missing physical work are omitted", async () => {
  const managed = createDefaultManagedApiDatabase({ API_DATABASE: "memory" });
  try {
    await managed.migrate();
    const db = managed.db;
    const runtime = createServiceTestRuntime(db);
    const organizationId = crypto.randomUUID();
    const active = await seedPendingBlobDeletion(db, organizationId, {
      ageMs: 2 * GRACE,
    });
    const revived = await seedPendingBlobDeletion(db, organizationId);
    const deleted = await seedPendingBlobDeletion(db, organizationId);
    const missingKey = await seedPendingBlobDeletion(db, organizationId);
    const detached = await seedPendingBlobDeletion(db, organizationId);
    await db.insert(attachmentBindings).values([
      {
        blobId: active.blobId,
        documentId: crypto.randomUUID(),
        slotId: "active",
      },
      {
        blobId: detached.blobId,
        documentId: crypto.randomUUID(),
        slotId: "detached",
        detachedAt: new Date(),
      },
    ]);
    await db
      .update(blobs)
      .set({ dereferencedAt: null })
      .where(eq(blobs.id, revived.blobId));
    await db
      .update(blobAuditObjects)
      .set({ objectDeletedAt: wallClockNowExpression() })
      .where(eq(blobAuditObjects.blobId, deleted.blobId));
    await db.delete(blobs).where(eq(blobs.id, missingKey.blobId));
    await db
      .update(blobAuditObjects)
      .set({ prunedAt: wallClockNowExpression(), liveStorageKey: null })
      .where(eq(blobAuditObjects.blobId, missingKey.blobId));
    expect(
      (
        await listRootPendingBlobDeletions(runtime, { organizationId })
      ).blobs.map((row) => row.blobId),
    ).toEqual([detached.blobId]);
    // A rebind must disappear immediately, even before GC clears a stale dereference marker.
    await db.insert(attachmentBindings).values({
      blobId: detached.blobId,
      documentId: crypto.randomUUID(),
      slotId: "rebound",
    });
    expect(
      await listRootPendingBlobDeletions(runtime, { organizationId }),
    ).toEqual({ blobs: [], nextAfterId: null });
    // An old tombstone with a live row must not resurrect physical-deletion work.
    await db
      .update(blobAuditObjects)
      .set({ prunedAt: wallClockNowExpression() })
      .where(eq(blobAuditObjects.blobId, revived.blobId));
    expect(
      await listRootPendingBlobDeletions(runtime, { organizationId }),
    ).toEqual({ blobs: [], nextAfterId: null });
    // SQL comparison uses the same boundary as GC: eligible at exactly one grace period.
    await db
      .delete(attachmentBindings)
      .where(eq(attachmentBindings.blobId, detached.blobId));
    await db
      .update(blobs)
      .set({
        dereferencedAt: sql`${wallClockNowExpression()} - ${GRACE} * interval '1 millisecond'`,
      })
      .where(eq(blobs.id, detached.blobId));
    expect(
      (await listRootPendingBlobDeletions(runtime, { organizationId })).blobs[0]
        ?.status,
    ).toBe("eligible");
  } finally {
    await managed.close();
  }
});
