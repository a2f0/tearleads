import { expect, test } from "bun:test";
import { createDefaultManagedApiDatabase } from "@tearleads/api-shared/postgres";
import { blobAuditObjects, blobs } from "@tearleads/api-shared/schema";
import type { PendingBlobDeletion } from "@tearleads/validators/response";
import { eq } from "drizzle-orm";
import { seedPendingBlobDeletion } from "../../../test/helpers/pendingBlobDeletion";
import { createServiceTestRuntime } from "../../../test/helpers/serviceRuntime";
import { encodeCursor } from "../../utils/cursor";
import { DEFAULT_BLOB_GC_GRACE_PERIOD_MS } from "../../workflows/blobs/gc/gracePeriod";
import { runReclaimDereferencedBlobsWorkflow } from "../../workflows/blobs/gc/reclaimDereferencedBlobs";
import { listRootPendingBlobDeletions } from "./pendingDeletions";

test("pages span both phases, remain scoped and continue after the cursor row disappears", async () => {
  const managed = createDefaultManagedApiDatabase({ API_DATABASE: "memory" });
  try {
    await managed.migrate();
    const db = managed.db;
    const runtime = createServiceTestRuntime(db);
    const organizationId = crypto.randomUUID();
    const otherOrganizationId = crypto.randomUUID();
    const ids = Array.from({ length: 6 }, () => crypto.randomUUID()).sort();
    const [firstId, cursorId, nextId, fourthId] = ids;
    if (!firstId || !cursorId || !nextId || !fourthId) {
      throw new Error("Expected six sorted blob IDs");
    }
    for (const blobId of ids) {
      await seedPendingBlobDeletion(db, organizationId, {
        blobId,
        ageMs: 2 * DEFAULT_BLOB_GC_GRACE_PERIOD_MS,
      });
    }
    const foreign = await seedPendingBlobDeletion(db, otherOrganizationId);
    await runReclaimDereferencedBlobsWorkflow(db, {
      blobIds: [firstId, fourthId],
    });
    const first = await listRootPendingBlobDeletions(runtime, {
      organizationId,
      limit: 2,
    });
    expect(first.blobs.map((row) => row.blobId)).toEqual(ids.slice(0, 2));
    expect(first.blobs.map((row) => row.status)).toEqual([
      "deletion-pending",
      "eligible",
    ]);
    expect(first.nextAfterId).toEqual(expect.any(String));
    const cursor = first.nextAfterId;
    if (!cursor) throw new Error("Expected continuation");
    expect(cursor).not.toBe(ids[1]);
    await db.delete(blobs).where(eq(blobs.id, cursorId));
    await db
      .delete(blobAuditObjects)
      .where(eq(blobAuditObjects.blobId, cursorId));
    await runReclaimDereferencedBlobsWorkflow(db, { blobIds: [nextId] });
    const collected: PendingBlobDeletion[] = [...first.blobs];
    let next: string | null = cursor;
    while (next !== null) {
      const page = await listRootPendingBlobDeletions(runtime, {
        organizationId,
        limit: 2,
        cursor: next,
      });
      expect(page.blobs.length).toBeLessThanOrEqual(2);
      collected.push(...page.blobs);
      next = page.nextAfterId;
    }
    expect(collected.map((row) => row.blobId)).toEqual(ids);
    expect(
      collected.every((row) => row.organizationId === organizationId),
    ).toBe(true);
    expect(
      (await listRootPendingBlobDeletions(runtime, {})).blobs.map(
        (row) => row.blobId,
      ),
    ).toContain(foreign.blobId);
    for (const invalid of [
      cursor,
      "not-a-cursor",
      cursorId,
      "a".repeat(513),
      encodeCursor({ afterId: ids[1] }),
      encodeCursor({
        scope: `root:pending-blob-deletions:${otherOrganizationId}`,
        afterId: "bad",
      }),
    ]) {
      await expect(
        listRootPendingBlobDeletions(runtime, {
          organizationId: otherOrganizationId,
          cursor: invalid,
        }),
      ).rejects.toThrow("Invalid cursor");
    }
    await expect(
      listRootPendingBlobDeletions(runtime, { cursor }),
    ).rejects.toThrow("Invalid cursor");
    expect(
      await listRootPendingBlobDeletions(runtime, {
        organizationId: crypto.randomUUID(),
      }),
    ).toEqual({ blobs: [], nextAfterId: null });
  } finally {
    await managed.close();
  }
});

test("default and maximum pages bound results and do not emit a cursor for an exact final page", async () => {
  const managed = createDefaultManagedApiDatabase({ API_DATABASE: "memory" });
  try {
    await managed.migrate();
    const db = managed.db;
    const runtime = createServiceTestRuntime(db);
    const organizationId = crypto.randomUUID();
    const ids = Array.from({ length: 101 }, () => crypto.randomUUID()).sort();
    // Pruned rows alone prove pagination does not depend on the live blob table.
    await db.insert(blobAuditObjects).values(
      ids.map((blobId) => ({
        blobId,
        organizationId,
        byteLength: 1,
        sha256: "a".repeat(64),
        retentionMode: "live_only" as const,
        historicalBytesRetained: false,
        liveStorageKey: `organizations/${organizationId}/blob-stages/${blobId}`,
        prunedAt: new Date(),
      })),
    );
    const defaultPage = await listRootPendingBlobDeletions(runtime, {
      organizationId,
    });
    expect(defaultPage.blobs.map((row) => row.blobId)).toEqual(
      ids.slice(0, 50),
    );
    expect(defaultPage.nextAfterId).not.toBeNull();
    const maximum = await listRootPendingBlobDeletions(runtime, {
      organizationId,
      limit: 100,
    });
    expect(maximum.blobs.map((row) => row.blobId)).toEqual(ids.slice(0, 100));
    if (!maximum.nextAfterId)
      throw new Error("Expected maximum-page continuation");
    const last = await listRootPendingBlobDeletions(runtime, {
      organizationId,
      limit: 1,
      cursor: maximum.nextAfterId,
    });
    expect(last.blobs.map((row) => row.blobId)).toEqual(ids.slice(100));
    expect(last.nextAfterId).toBeNull();
    const empty = await listRootPendingBlobDeletions(runtime, {
      organizationId,
      cursor: encodeCursor({
        afterId: ids[100],
        scope: `root:pending-blob-deletions:${organizationId}`,
      }),
    });
    expect(empty).toEqual({ blobs: [], nextAfterId: null });
  } finally {
    await managed.close();
  }
});
