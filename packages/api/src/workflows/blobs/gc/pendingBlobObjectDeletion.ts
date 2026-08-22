import type { ApiDatabase } from "@symcrypt/api-shared/postgres";
import { blobAuditObjects } from "@symcrypt/api-shared/schema";
import { and, asc, eq, isNotNull, isNull } from "drizzle-orm";

const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 1000;

interface PendingBlobObjectDeletion {
  readonly blobId: string;
  readonly storageKey: string;
}

function normalizeLimit(limit: number | undefined): number {
  if (limit === undefined || !Number.isInteger(limit) || limit < 1) {
    return DEFAULT_LIMIT;
  }
  return Math.min(limit, MAX_LIMIT);
}

/**
 * Durable deletion work consists of pruned audit rows that still retain their
 * object-store key. This includes work created by the current sweep and work a
 * prior process failed to finish or acknowledge.
 */
export async function listPendingBlobObjectDeletions(
  db: ApiDatabase,
  input: { readonly limit?: number } = {},
): Promise<PendingBlobObjectDeletion[]> {
  const rows = await db
    .select({
      blobId: blobAuditObjects.blobId,
      storageKey: blobAuditObjects.liveStorageKey,
    })
    .from(blobAuditObjects)
    .where(
      and(
        isNotNull(blobAuditObjects.prunedAt),
        isNull(blobAuditObjects.objectDeletedAt),
        isNotNull(blobAuditObjects.liveStorageKey),
      ),
    )
    .orderBy(asc(blobAuditObjects.prunedAt), asc(blobAuditObjects.blobId))
    .limit(normalizeLimit(input.limit));

  return rows.flatMap((row) =>
    row.storageKey === null
      ? []
      : [{ blobId: row.blobId, storageKey: row.storageKey }],
  );
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
