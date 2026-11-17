import type {
  ApiDatabase,
  DatabaseTransaction,
} from "@tearleads/api-shared/postgres";
import {
  attachmentBindings,
  blobAuditObjects,
  blobContentKeyEpochs,
  blobContentKeyTargets,
  blobContentWriteHeaders,
  blobs,
} from "@tearleads/api-shared/schema";
import {
  and,
  asc,
  eq,
  inArray,
  isNotNull,
  isNull,
  lte,
  sql,
} from "drizzle-orm";
import { wallClockNowExpression } from "../../../utils/postgresSql";
import { blobStorageKeyMatchesOrganization } from "../storageKeys";

/**
 * Candidates reclaimed under one transaction. It covers a default sweep and one
 * organization-purge batch, and keeps the blob-row lock set bounded.
 */
export const RECLAIM_CHUNK_SIZE = 500;

/**
 * A candidate without an outcome was skipped: since selection it was revived,
 * detached again, or reclaimed by another sweep.
 */
export type BlobReclaimOutcome =
  | { readonly kind: "revived" }
  | { readonly kind: "reclaimed" }
  | { readonly kind: "failed"; readonly error: unknown };

interface LockedBlob {
  readonly byteLength: number;
  readonly id: string;
  readonly sha256: string;
  readonly storageKey: string;
}

interface BlobAuditRow {
  readonly blobId: string;
  readonly byteLength: number;
  readonly liveStorageKey: string | null;
  readonly organizationId: string;
  readonly retentionMode: string;
  readonly sha256: string;
}

/** The reason a locked, unreferenced blob must not be reclaimed, if any. */
function reclaimAuditError(
  blob: LockedBlob,
  auditObject: BlobAuditRow | undefined,
): Error | undefined {
  if (
    !auditObject ||
    auditObject.byteLength !== blob.byteLength ||
    auditObject.liveStorageKey !== blob.storageKey ||
    auditObject.retentionMode !== "live_only" ||
    auditObject.sha256 !== blob.sha256
  ) {
    return new Error(
      `Blob ${blob.id} audit metadata does not match live storage`,
    );
  }
  if (
    !blobStorageKeyMatchesOrganization(
      blob.storageKey,
      auditObject.organizationId,
    )
  ) {
    return new Error("Blob storage key does not match its organization");
  }
  return undefined;
}

// Live reachability is intentionally narrower than the blob registry. Detached
// bindings and `blob_audit_objects` preserve metadata, but only an ACTIVE
// binding keeps blob bytes and key material live.
async function listActivelyReferencedBlobIds(
  executor: DatabaseTransaction,
  blobIds: readonly string[],
): Promise<Set<string>> {
  const rows = await executor
    .selectDistinct({ blobId: attachmentBindings.blobId })
    .from(attachmentBindings)
    .where(
      and(
        inArray(attachmentBindings.blobId, [...blobIds]),
        isNull(attachmentBindings.detachedAt),
      ),
    );
  return new Set(rows.map((row) => row.blobId));
}

async function deleteBlobKeyRows(
  executor: DatabaseTransaction,
  blobIds: readonly string[],
): Promise<void> {
  // Delete the per-epoch target envelopes via a subquery on the blobs' epochs,
  // then the epochs and write headers — one round-trip each, no client-side
  // epoch-id fetch.
  await executor.delete(blobContentKeyTargets).where(
    inArray(
      blobContentKeyTargets.blobContentKeyEpochId,
      executor
        .select({ id: blobContentKeyEpochs.id })
        .from(blobContentKeyEpochs)
        .where(inArray(blobContentKeyEpochs.blobId, [...blobIds])),
    ),
  );
  await executor
    .delete(blobContentKeyEpochs)
    .where(inArray(blobContentKeyEpochs.blobId, [...blobIds]));
  await executor
    .delete(blobContentWriteHeaders)
    .where(inArray(blobContentWriteHeaders.blobId, [...blobIds]));
}

async function pruneReclaimableBlobs(
  executor: DatabaseTransaction,
  blobIds: readonly string[],
): Promise<void> {
  await deleteBlobKeyRows(executor, blobIds);
  await executor
    .delete(attachmentBindings)
    .where(inArray(attachmentBindings.blobId, [...blobIds]));
  // Each audit row keeps its own blob's storage key as the durable physical
  // deletion work item, read from the locked blob row it was validated against.
  await executor
    .update(blobAuditObjects)
    .set({
      liveStorageKey: sql`${blobs.storageKey}`,
      objectDeletedAt: null,
      prunedAt: wallClockNowExpression(),
    })
    .from(blobs)
    .where(
      and(
        eq(blobs.id, blobAuditObjects.blobId),
        inArray(blobAuditObjects.blobId, [...blobIds]),
      ),
    );
  await executor.delete(blobs).where(inArray(blobs.id, [...blobIds]));
}

/**
 * Lock and reclaim a chunk of candidate blobs in one transaction. The rows are
 * locked in UUID order, the order every blob-row locker uses
 * (`lockBlobMutationRows`), so a chunk cannot form a lock cycle with an
 * attachment mutation, a purge, or another sweep. The FOR UPDATE serializes
 * against a concurrent bind, which locks the same blob row before inserting its
 * binding and clearing `dereferencedAt`: either the bind commits first (the
 * lock query's recheck then sees `dereferencedAt` cleared and skips the blob)
 * or this chunk commits first (the bind's lock then finds the blob gone and
 * fails closed).
 *
 * Active bindings are read by a separate statement after the lock, so they
 * come from a snapshot taken once every lock is held; a row-lock recheck would
 * only refresh the blob row, not the bindings. A still-referenced blob is
 * revived, and a blob whose audit metadata does not match is left untouched
 * and reported as failed, without blocking the rest of the chunk.
 */
async function reclaimLockedBlobChunk(
  executor: DatabaseTransaction,
  input: {
    readonly blobIds: readonly string[];
    readonly cutoff: Date;
  },
): Promise<Map<string, BlobReclaimOutcome>> {
  const outcomes = new Map<string, BlobReclaimOutcome>();
  const lockQuery = executor
    .select({
      byteLength: blobs.byteLength,
      id: blobs.id,
      sha256: blobs.sha256,
      storageKey: blobs.storageKey,
    })
    .from(blobs)
    .where(
      and(
        inArray(blobs.id, [...input.blobIds]),
        isNotNull(blobs.dereferencedAt),
        lte(blobs.dereferencedAt, input.cutoff),
      ),
    )
    .orderBy(asc(blobs.id));
  const locked = await lockQuery.for("update");
  if (locked.length === 0) {
    return outcomes;
  }

  const referenced = await listActivelyReferencedBlobIds(
    executor,
    locked.map((blob) => blob.id),
  );
  if (referenced.size > 0) {
    await executor
      .update(blobs)
      .set({ dereferencedAt: null, reclaimAttemptedAt: null })
      .where(inArray(blobs.id, [...referenced]));
    for (const blobId of referenced) {
      outcomes.set(blobId, { kind: "revived" });
    }
  }
  const unreferenced = locked.filter((blob) => !referenced.has(blob.id));
  if (unreferenced.length === 0) {
    return outcomes;
  }

  const auditObjects = await executor
    .select({
      blobId: blobAuditObjects.blobId,
      byteLength: blobAuditObjects.byteLength,
      liveStorageKey: blobAuditObjects.liveStorageKey,
      organizationId: blobAuditObjects.organizationId,
      retentionMode: blobAuditObjects.retentionMode,
      sha256: blobAuditObjects.sha256,
    })
    .from(blobAuditObjects)
    .where(
      inArray(
        blobAuditObjects.blobId,
        unreferenced.map((blob) => blob.id),
      ),
    );
  const auditByBlobId = new Map(
    auditObjects.map((auditObject) => [auditObject.blobId, auditObject]),
  );
  const reclaimable: string[] = [];
  for (const blob of unreferenced) {
    const error = reclaimAuditError(blob, auditByBlobId.get(blob.id));
    if (error) {
      outcomes.set(blob.id, { error, kind: "failed" });
    } else {
      reclaimable.push(blob.id);
    }
  }
  if (reclaimable.length === 0) {
    return outcomes;
  }

  await pruneReclaimableBlobs(executor, reclaimable);
  for (const blobId of reclaimable) {
    outcomes.set(blobId, { kind: "reclaimed" });
  }
  return outcomes;
}

function reclaimInOwnTransaction(
  db: ApiDatabase,
  input: {
    readonly blobIds: readonly string[];
    readonly cutoff: Date;
  },
): Promise<Map<string, BlobReclaimOutcome>> {
  return db.transaction((tx) => reclaimLockedBlobChunk(tx, input));
}

/**
 * Reclaims a chunk in one transaction. When that transaction throws, each
 * candidate is retried in its own transaction, so one bad candidate cannot
 * block the rest; only those per-blob failures are reported.
 */
export async function reclaimBlobChunk(
  db: ApiDatabase,
  input: {
    readonly blobIds: readonly string[];
    readonly cutoff: Date;
  },
): Promise<ReadonlyMap<string, BlobReclaimOutcome>> {
  try {
    return await reclaimInOwnTransaction(db, input);
  } catch (error) {
    if (input.blobIds.length === 1) {
      return new Map(
        input.blobIds.map((blobId): [string, BlobReclaimOutcome] => [
          blobId,
          { error, kind: "failed" },
        ]),
      );
    }
  }
  const outcomes = new Map<string, BlobReclaimOutcome>();
  for (const blobId of input.blobIds) {
    try {
      const single = await reclaimInOwnTransaction(db, {
        blobIds: [blobId],
        cutoff: input.cutoff,
      });
      for (const [id, outcome] of single) {
        outcomes.set(id, outcome);
      }
    } catch (error) {
      outcomes.set(blobId, { error, kind: "failed" });
    }
  }
  return outcomes;
}
