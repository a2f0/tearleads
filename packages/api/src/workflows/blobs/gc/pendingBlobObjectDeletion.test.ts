import { expect, setSystemTime, test } from "bun:test";
import { db, getDefaultApiDatabaseKind } from "@tearleads/api-shared/postgres";
import { blobAuditObjects } from "@tearleads/api-shared/schema";
import { eq } from "drizzle-orm";
import { selectFairBlobWorkCandidates } from "./fairBlobWorkSelection";
import {
  listPendingBlobObjectDeletions,
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

test.skipIf(getDefaultApiDatabaseKind() !== "postgres")(
  "two maintenance workers safely acknowledge the same deletion",
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

    let releaseFirstAck!: () => void;
    const firstAckRelease = new Promise<void>((resolve) => {
      releaseFirstAck = resolve;
    });
    let markFirstAckHeld!: () => void;
    const firstAckHeld = new Promise<void>((resolve) => {
      markFirstAckHeld = resolve;
    });
    let firstAck: Promise<void> | undefined;
    let secondAck: Promise<void> | undefined;
    try {
      const [firstSelection, secondSelection] = await Promise.all([
        listPendingBlobObjectDeletions(db, { limit: 1 }),
        listPendingBlobObjectDeletions(db, { limit: 1 }),
      ]);
      expect(firstSelection).toEqual([{ blobId, storageKey }]);
      expect(secondSelection).toEqual([{ blobId, storageKey }]);
      const firstPending = firstSelection[0];
      const secondPending = secondSelection[0];
      if (!firstPending || !secondPending) {
        throw new Error("Both maintenance workers must select the deletion");
      }

      expect(
        await Promise.all([
          recordBlobObjectDeletionAttempt(db, firstPending),
          recordBlobObjectDeletionAttempt(db, secondPending),
        ]),
      ).toEqual([true, true]);

      const physicallyDeleted = new Set<string>();
      const deleteObject = (pending: typeof firstPending): Promise<void> => {
        physicallyDeleted.add(pending.storageKey);
        return Promise.resolve();
      };
      await Promise.all([
        deleteObject(firstPending),
        deleteObject(secondPending),
      ]);
      expect([...physicallyDeleted]).toEqual([storageKey]);

      firstAck = db.transaction(async (tx) => {
        await recordBlobObjectDeleted(tx, firstPending);
        markFirstAckHeld();
        await firstAckRelease;
      });
      await firstAckHeld;

      let secondAckSettled = false;
      secondAck = recordBlobObjectDeleted(db, secondPending).then(() => {
        secondAckSettled = true;
      });
      await new Promise((resolve) => setTimeout(resolve, 300));
      expect(secondAckSettled).toBe(false);

      releaseFirstAck();
      await Promise.all([firstAck, secondAck]);
      expect(secondAckSettled).toBe(true);
      const [completed] = await db
        .select({
          liveStorageKey: blobAuditObjects.liveStorageKey,
          objectDeletedAt: blobAuditObjects.objectDeletedAt,
        })
        .from(blobAuditObjects)
        .where(eq(blobAuditObjects.blobId, blobId));
      expect(completed?.liveStorageKey).toBeNull();
      expect(completed?.objectDeletedAt).toBeInstanceOf(Date);
      expect(
        (await listPendingBlobObjectDeletions(db, { limit: 1000 })).some(
          (pending) => pending.blobId === blobId,
        ),
      ).toBe(false);
    } finally {
      releaseFirstAck();
      await Promise.all([
        firstAck?.catch(() => undefined),
        secondAck?.catch(() => undefined),
      ]);
      await db
        .delete(blobAuditObjects)
        .where(eq(blobAuditObjects.blobId, blobId));
    }
  },
  30_000,
);
