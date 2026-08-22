import { expect, setSystemTime, test } from "bun:test";
import { db, getDefaultApiDatabaseKind } from "@symcrypt/api-shared/postgres";
import { blobAuditObjects } from "@symcrypt/api-shared/schema";
import { eq } from "drizzle-orm";
import { selectFairBlobWorkCandidates } from "./fairBlobWorkSelection";
import {
  recordBlobObjectDeleted,
  recordBlobObjectDeletionAttempt,
} from "./pendingBlobObjectDeletion";

test("pending deletion selection deduplicates rows across query snapshots", () => {
  const duplicate = {
    blobId: "duplicate",
    queuedAt: new Date("2026-08-22T00:00:00.000Z"),
    storageKey: "storage:duplicate",
  };
  const healthy = {
    blobId: "healthy",
    queuedAt: new Date("2026-08-22T00:01:00.000Z"),
    storageKey: "storage:healthy",
  };

  expect(
    selectFairBlobWorkCandidates(
      [duplicate, healthy],
      [{ ...duplicate, queuedAt: new Date("2026-08-22T00:02:00.000Z") }],
      2,
    ).map((candidate) => candidate.blobId),
  ).toEqual(["healthy", "duplicate"]);
});

test.skipIf(getDefaultApiDatabaseKind() !== "postgres")(
  "object deletion timestamps use the database clock",
  async () => {
    const blobId = crypto.randomUUID();
    const storageKey = `blob-object:${blobId}`;
    await db.insert(blobAuditObjects).values({
      blobId,
      byteLength: 1,
      historicalBytesRetained: false,
      liveStorageKey: storageKey,
      organizationId: crypto.randomUUID(),
      prunedAt: new Date("2000-01-01T00:00:00.000Z"),
      retentionMode: "live_only",
      sha256: `sha256:${blobId}`,
    });

    try {
      try {
        setSystemTime(new Date("2099-01-01T00:00:00.000Z"));
        expect(
          await recordBlobObjectDeletionAttempt(db, { blobId, storageKey }),
        ).toBe(true);
        await recordBlobObjectDeleted(db, { blobId, storageKey });
      } finally {
        setSystemTime();
      }
      const [row] = await db
        .select({
          attemptedAt: blobAuditObjects.objectDeleteAttemptedAt,
          deletedAt: blobAuditObjects.objectDeletedAt,
        })
        .from(blobAuditObjects)
        .where(eq(blobAuditObjects.blobId, blobId));
      expect(row?.attemptedAt?.getUTCFullYear()).toBeLessThan(2090);
      expect(row?.deletedAt?.getUTCFullYear()).toBeLessThan(2090);
    } finally {
      setSystemTime();
      await db
        .delete(blobAuditObjects)
        .where(eq(blobAuditObjects.blobId, blobId));
    }
  },
);
