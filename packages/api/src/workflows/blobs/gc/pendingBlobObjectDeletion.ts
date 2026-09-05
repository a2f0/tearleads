import type {
  ApiDatabase,
  DatabaseSession,
} from "@tearleads/api-shared/postgres";
import { blobAuditObjects } from "@tearleads/api-shared/schema";
import { and, asc, eq, inArray, isNotNull, isNull } from "drizzle-orm";
import { wallClockNowExpression } from "../../../utils/sqlDialect";
import { selectFairBlobWorkCandidates } from "./fairBlobWorkSelection";

const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 1000;

interface PendingBlobObjectDeletion {
  readonly blobId: string;
  readonly organizationId: string;
  readonly storageKey: string;
}

interface PendingDeletionCandidate extends PendingBlobObjectDeletion {
  readonly queuedAt: Date;
}

interface PendingDeletionRow {
  readonly attemptedAt: Date | null;
  readonly blobId: string;
  readonly organizationId: string;
  readonly prunedAt: Date | null;
  readonly storageKey: string | null;
}

function normalizeLimit(limit: number | undefined): number {
  if (limit === undefined || !Number.isInteger(limit) || limit < 1) {
    return DEFAULT_LIMIT;
  }
  return Math.min(limit, MAX_LIMIT);
}

function toPendingCandidates(
  rows: readonly PendingDeletionRow[],
  queuedAtColumn: "attemptedAt" | "prunedAt",
): PendingDeletionCandidate[] {
  return rows.flatMap((row): PendingDeletionCandidate[] => {
    const queuedAt = row[queuedAtColumn];
    return queuedAt === null || row.storageKey === null
      ? []
      : [
          {
            blobId: row.blobId,
            organizationId: row.organizationId,
            queuedAt,
            storageKey: row.storageKey,
          },
        ];
  });
}

/**
 * Durable deletion work consists of pruned audit rows that still retain their
 * object-store key. New work and retries each receive batch capacity; a
 * single-slot maintenance run chooses the oldest class timestamp, and each
 * failed attempt rotates its retry behind work that was already waiting.
 */
export async function listPendingBlobObjectDeletions(
  db: ApiDatabase,
  input: {
    readonly blobIds?: readonly string[];
    readonly limit?: number;
  } = {},
): Promise<PendingBlobObjectDeletion[]> {
  const limit = normalizeLimit(input.limit);
  const scopedBlobIds = input.blobIds ? [...new Set(input.blobIds)] : undefined;
  if (scopedBlobIds?.length === 0) return [];
  const pendingPredicate = and(
    isNotNull(blobAuditObjects.prunedAt),
    isNull(blobAuditObjects.objectDeletedAt),
    isNotNull(blobAuditObjects.liveStorageKey),
    scopedBlobIds ? inArray(blobAuditObjects.blobId, scopedBlobIds) : undefined,
  );
  const selectedColumns = {
    attemptedAt: blobAuditObjects.objectDeleteAttemptedAt,
    blobId: blobAuditObjects.blobId,
    organizationId: blobAuditObjects.organizationId,
    prunedAt: blobAuditObjects.prunedAt,
    storageKey: blobAuditObjects.liveStorageKey,
  };
  const [newRows, retryRows] = await Promise.all([
    db
      .select(selectedColumns)
      .from(blobAuditObjects)
      .where(
        and(pendingPredicate, isNull(blobAuditObjects.objectDeleteAttemptedAt)),
      )
      .orderBy(asc(blobAuditObjects.prunedAt), asc(blobAuditObjects.blobId))
      .limit(limit),
    db
      .select(selectedColumns)
      .from(blobAuditObjects)
      .where(
        and(
          pendingPredicate,
          isNotNull(blobAuditObjects.objectDeleteAttemptedAt),
        ),
      )
      .orderBy(
        asc(blobAuditObjects.objectDeleteAttemptedAt),
        asc(blobAuditObjects.prunedAt),
        asc(blobAuditObjects.blobId),
      )
      .limit(limit),
  ]);
  const selected = selectFairBlobWorkCandidates(
    toPendingCandidates(newRows, "prunedAt"),
    toPendingCandidates(retryRows, "attemptedAt"),
    limit,
  );

  return selected.map(({ blobId, organizationId, storageKey }) => ({
    blobId,
    organizationId,
    storageKey,
  }));
}

/**
 * Persist an attempt before calling the object store. Failed work rotates by
 * this timestamp on later runs, including in a single-slot queue.
 */
export async function recordBlobObjectDeletionAttempt(
  db: DatabaseSession,
  input: PendingBlobObjectDeletion,
): Promise<boolean> {
  const updated = await db
    .update(blobAuditObjects)
    .set({ objectDeleteAttemptedAt: wallClockNowExpression() })
    .where(
      and(
        eq(blobAuditObjects.blobId, input.blobId),
        eq(blobAuditObjects.organizationId, input.organizationId),
        eq(blobAuditObjects.liveStorageKey, input.storageKey),
        isNotNull(blobAuditObjects.prunedAt),
        isNull(blobAuditObjects.objectDeletedAt),
      ),
    )
    .returning({ blobId: blobAuditObjects.blobId });
  return updated.length > 0;
}

/** Record physical deletion without erasing immutable blob audit metadata. */
export async function recordBlobObjectDeleted(
  db: DatabaseSession,
  input: PendingBlobObjectDeletion,
): Promise<void> {
  const updated = await db
    .update(blobAuditObjects)
    .set({
      liveStorageKey: null,
      objectDeletedAt: wallClockNowExpression(),
    })
    .where(
      and(
        eq(blobAuditObjects.blobId, input.blobId),
        eq(blobAuditObjects.organizationId, input.organizationId),
        eq(blobAuditObjects.liveStorageKey, input.storageKey),
        isNotNull(blobAuditObjects.prunedAt),
        isNull(blobAuditObjects.objectDeletedAt),
      ),
    )
    .returning({ blobId: blobAuditObjects.blobId });
  if (updated.length > 0) {
    return;
  }

  // Concurrent maintenance processes may both issue the idempotent object
  // delete. Treat a row the other process already completed as acknowledged;
  // any other mismatch must stay visible as failed work.
  const [current] = await db
    .select({
      liveStorageKey: blobAuditObjects.liveStorageKey,
      objectDeletedAt: blobAuditObjects.objectDeletedAt,
    })
    .from(blobAuditObjects)
    .where(
      and(
        eq(blobAuditObjects.blobId, input.blobId),
        eq(blobAuditObjects.organizationId, input.organizationId),
      ),
    )
    .limit(1);
  if (current?.liveStorageKey === null && current.objectDeletedAt !== null) {
    return;
  }
  throw new Error(`Blob ${input.blobId} deletion acknowledgement was rejected`);
}
