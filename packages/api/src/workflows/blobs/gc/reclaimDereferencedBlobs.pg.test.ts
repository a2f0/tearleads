import { expect, setSystemTime, test } from "bun:test";
import { db, getDefaultApiDatabaseKind } from "@tearleads/api-shared/postgres";
import { blobAuditObjects, blobs } from "@tearleads/api-shared/schema";
import { eq, sql } from "drizzle-orm";
import { wallClockNowExpression } from "../../../utils/sqlDialect";
import { lockBlobMutationRows } from "../mutations/blobMutationLocks";
import {
  deferFailedBlobReclaim,
  runReclaimDereferencedBlobsWorkflow,
} from "./reclaimDereferencedBlobs";

const ORGANIZATION_ID = "fd48148f-2bb0-420d-925a-7007d5c1c40f";

const HOUR_MS = 60 * 60 * 1000;

async function insertDereferencedBlob(input: {
  readonly id: string;
  readonly dereferencedAt: Date;
}): Promise<void> {
  const storageKey = `organizations/${ORGANIZATION_ID}/blob-stages/${input.id}`;
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

async function readDatabaseWallClock(): Promise<Date> {
  const [row] = await db
    .select({ now: wallClockNowExpression().mapWith(blobs.createdAt) })
    .from(sql`(select 1) as database_clock`);
  if (!row) {
    throw new Error("Database wall clock query returned no row");
  }
  return row.now;
}

async function cleanupBlob(blobId: string): Promise<void> {
  await db.delete(blobs).where(eq(blobs.id, blobId));
  await db.delete(blobAuditObjects).where(eq(blobAuditObjects.blobId, blobId));
}

test.skipIf(getDefaultApiDatabaseKind() !== "postgres")(
  "uses the database clock for the default cutoff under API host skew",
  async () => {
    const actualNow = new Date();
    const blobId = crypto.randomUUID();
    await insertDereferencedBlob({ id: blobId, dereferencedAt: actualNow });

    setSystemTime(new Date(actualNow.getTime() + 48 * HOUR_MS));
    try {
      const result = await runReclaimDereferencedBlobsWorkflow(db, {
        gracePeriodMs: 24 * HOUR_MS,
      });

      expect(result.reclaimedBlobIds).not.toContain(blobId);
      expect(await blobExists(blobId)).toBe(true);
    } finally {
      setSystemTime();
      await cleanupBlob(blobId);
    }
  },
);

test.skipIf(getDefaultApiDatabaseKind() !== "postgres")(
  "a PostgreSQL timestamp with microseconds rotates after reclaim failure",
  async () => {
    const retryAt = new Date();
    const blobId = crypto.randomUUID();
    await insertDereferencedBlob({
      dereferencedAt: new Date(retryAt.getTime() - 49 * HOUR_MS),
      id: blobId,
    });
    try {
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
    } finally {
      await cleanupBlob(blobId);
    }
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
      await cleanupBlob(blobId);
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

    try {
      await new Promise((resolve) => setTimeout(resolve, 300));
      expect(reclaimSettled).toBe(false);
      releaseHold();
      const [, result] = await Promise.all([holder, reclaim]);
      expect(result.reclaimedBlobIds).not.toContain(blobId);
      expect(await blobExists(blobId)).toBe(true);
    } finally {
      releaseHold();
      await Promise.all([
        holder.catch(() => undefined),
        reclaim.catch(() => undefined),
      ]);
      await cleanupBlob(blobId);
    }
  },
  30_000,
);

test.skipIf(getDefaultApiDatabaseKind() !== "postgres")(
  "starts the prune audit timestamp after a delayed row lock",
  async () => {
    const sweepStartedAt = new Date();
    const blobId = crypto.randomUUID();
    await insertDereferencedBlob({
      dereferencedAt: new Date(sweepStartedAt.getTime() - 48 * HOUR_MS),
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
    });

    await held;
    let reclaimSettled = false;
    const reclaim = runReclaimDereferencedBlobsWorkflow(db, {
      gracePeriodMs: 24 * HOUR_MS,
      now: sweepStartedAt,
    }).then((result) => {
      reclaimSettled = true;
      return result;
    });

    try {
      await new Promise((resolve) => setTimeout(resolve, 300));
      const releaseClock = await readDatabaseWallClock();
      expect(reclaimSettled).toBe(false);

      releaseHold();
      const [, result] = await Promise.all([holder, reclaim]);
      expect(result.reclaimedBlobIds).toContain(blobId);

      const [auditObject] = await db
        .select({ prunedAt: blobAuditObjects.prunedAt })
        .from(blobAuditObjects)
        .where(eq(blobAuditObjects.blobId, blobId));
      expect(
        auditObject?.prunedAt?.getTime() ?? Number.NEGATIVE_INFINITY,
      ).toBeGreaterThanOrEqual(releaseClock.getTime());
    } finally {
      releaseHold();
      await Promise.all([
        holder.catch(() => undefined),
        reclaim.catch(() => undefined),
      ]);
      await cleanupBlob(blobId);
    }
  },
  30_000,
);
