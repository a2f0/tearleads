import type { ApiDatabase } from "@symcrypt/api-shared/postgres";
import { blobAuditObjects } from "@symcrypt/api-shared/schema";
import { and, asc, eq, isNotNull, isNull } from "drizzle-orm";

const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 1000;
const SINGLE_SLOT_RETRY_DELAY_MS = 5 * 60 * 1000;

interface PendingBlobObjectDeletion {
  readonly blobId: string;
  readonly storageKey: string;
}

interface PendingDeletionCandidate extends PendingBlobObjectDeletion {
  readonly queuedAt: Date;
}

interface PendingDeletionRow {
  readonly attemptedAt: Date | null;
  readonly blobId: string;
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
      : [{ blobId: row.blobId, queuedAt, storageKey: row.storageKey }];
  });
}

function compareQueued(
  left: PendingDeletionCandidate,
  right: PendingDeletionCandidate,
): number {
  return (
    left.queuedAt.getTime() - right.queuedAt.getTime() ||
    left.blobId.localeCompare(right.blobId)
  );
}

function selectFairCandidates(
  newWork: readonly PendingDeletionCandidate[],
  retries: readonly PendingDeletionCandidate[],
  limit: number,
): PendingDeletionCandidate[] {
  if (newWork.length === 0 || retries.length === 0) {
    return [...newWork, ...retries].slice(0, limit);
  }
  const oldestNew = newWork[0];
  const oldestRetry = retries[0];
  if (!oldestNew || !oldestRetry) {
    throw new Error("Pending deletion queue selection lost a candidate");
  }
  if (limit === 1) {
    const retryIsDue =
      oldestRetry.queuedAt.getTime() <= Date.now() - SINGLE_SLOT_RETRY_DELAY_MS;
    return [retryIsDue ? oldestRetry : oldestNew];
  }

  const newQuota = Math.ceil(limit / 2);
  const retryQuota = Math.floor(limit / 2);
  const selected = [
    ...newWork.slice(0, newQuota),
    ...retries.slice(0, retryQuota),
  ];
  selected.push(
    ...[...newWork.slice(newQuota), ...retries.slice(retryQuota)]
      .sort(compareQueued)
      .slice(0, limit - selected.length),
  );
  return selected;
}

/**
 * Durable deletion work consists of pruned audit rows that still retain their
 * object-store key. New work and retries each receive batch capacity; a
 * single-slot maintenance run delays a fresh failure briefly, then gives the
 * due retry priority so neither class can starve the other.
 */
export async function listPendingBlobObjectDeletions(
  db: ApiDatabase,
  input: { readonly limit?: number } = {},
): Promise<PendingBlobObjectDeletion[]> {
  const limit = normalizeLimit(input.limit);
  const pendingPredicate = and(
    isNotNull(blobAuditObjects.prunedAt),
    isNull(blobAuditObjects.objectDeletedAt),
    isNotNull(blobAuditObjects.liveStorageKey),
  );
  const selectedColumns = {
    attemptedAt: blobAuditObjects.objectDeleteAttemptedAt,
    blobId: blobAuditObjects.blobId,
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
  const selected = selectFairCandidates(
    toPendingCandidates(newRows, "prunedAt"),
    toPendingCandidates(retryRows, "attemptedAt"),
    limit,
  );

  return selected.map(({ blobId, storageKey }) => ({ blobId, storageKey }));
}

/**
 * Persist an attempt before calling the object store. Failed work rotates by
 * this timestamp on later runs and becomes due in a single-slot queue.
 */
export async function recordBlobObjectDeletionAttempt(
  db: ApiDatabase,
  input: PendingBlobObjectDeletion & { readonly attemptedAt: Date },
): Promise<boolean> {
  const updated = await db
    .update(blobAuditObjects)
    .set({ objectDeleteAttemptedAt: input.attemptedAt })
    .where(
      and(
        eq(blobAuditObjects.blobId, input.blobId),
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
  db: ApiDatabase,
  input: PendingBlobObjectDeletion & { readonly objectDeletedAt: Date },
): Promise<void> {
  const updated = await db
    .update(blobAuditObjects)
    .set({
      liveStorageKey: null,
      objectDeletedAt: input.objectDeletedAt,
    })
    .where(
      and(
        eq(blobAuditObjects.blobId, input.blobId),
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
    .where(eq(blobAuditObjects.blobId, input.blobId))
    .limit(1);
  if (current?.liveStorageKey === null && current.objectDeletedAt !== null) {
    return;
  }
  throw new Error(`Blob ${input.blobId} deletion acknowledgement was rejected`);
}
