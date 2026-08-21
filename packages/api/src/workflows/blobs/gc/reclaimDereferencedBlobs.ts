import type {
  ApiDatabase,
  DatabaseTransaction,
} from "@symcrypt/api-shared/postgres";
import {
  attachmentBindings,
  blobAuditObjects,
  blobContentKeyEpochs,
  blobContentKeyTargets,
  blobContentWriteHeaders,
  blobs,
  documentAttachmentAuditEvents,
} from "@symcrypt/api-shared/schema";
import { and, asc, eq, inArray, isNotNull, lte, or } from "drizzle-orm";
import { lockRowForUpdate } from "../../../utils/sqlDialect";

// A blob soft-deleted by purge is reclaimed only after this grace period, giving
// an in-flight or shortly-following re-bind time to revive it before the
// irreversible hard delete. Correctness does not depend on the grace (the
// per-blob FOR UPDATE + reachability re-check is authoritative); it is margin.
const DEFAULT_GRACE_PERIOD_MS = 24 * 60 * 60 * 1000;
const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 1000;

export interface ReclaimDereferencedBlobsInput {
  readonly now?: Date;
  readonly gracePeriodMs?: number;
  readonly limit?: number;
}

interface ReclaimDereferencedBlobsResult {
  readonly reclaimedBlobIds: string[];
  readonly revivedBlobIds: string[];
  readonly reclaimedStorageKeys: string[];
}

type ReclaimOutcome =
  | { readonly kind: "skipped" }
  | { readonly kind: "revived" }
  | { readonly kind: "reclaimed"; readonly storageKey: string };

function normalizeLimit(limit: number | undefined): number {
  if (limit === undefined) {
    return DEFAULT_LIMIT;
  }
  if (!Number.isInteger(limit) || limit < 1) {
    return DEFAULT_LIMIT;
  }
  return Math.min(limit, MAX_LIMIT);
}

// "Referenced" mirrors purgeDocument's reachability: a blob is live if ANY
// attachment binding (active OR detached history) references it, OR any
// attachment audit event names it as blobId or previousBlobId. Such a blob must
// be revived, never hard-deleted.
async function isBlobReferenced(
  executor: DatabaseTransaction,
  blobId: string,
): Promise<boolean> {
  const [binding] = await executor
    .select({ id: attachmentBindings.id })
    .from(attachmentBindings)
    .where(eq(attachmentBindings.blobId, blobId))
    .limit(1);
  if (binding) {
    return true;
  }

  const [auditEvent] = await executor
    .select({ blobId: documentAttachmentAuditEvents.blobId })
    .from(documentAttachmentAuditEvents)
    .where(
      or(
        eq(documentAttachmentAuditEvents.blobId, blobId),
        eq(documentAttachmentAuditEvents.previousBlobId, blobId),
      ),
    )
    .limit(1);

  return Boolean(auditEvent);
}

async function deleteBlobKeyRows(
  executor: DatabaseTransaction,
  blobId: string,
): Promise<void> {
  // Delete the per-epoch target envelopes via a subquery on the blob's epochs,
  // then the epochs and write headers — one round-trip each, no client-side
  // epoch-id fetch.
  await executor
    .delete(blobContentKeyTargets)
    .where(
      inArray(
        blobContentKeyTargets.blobContentKeyEpochId,
        executor
          .select({ id: blobContentKeyEpochs.id })
          .from(blobContentKeyEpochs)
          .where(eq(blobContentKeyEpochs.blobId, blobId)),
      ),
    );
  await executor
    .delete(blobContentKeyEpochs)
    .where(eq(blobContentKeyEpochs.blobId, blobId));
  await executor
    .delete(blobContentWriteHeaders)
    .where(eq(blobContentWriteHeaders.blobId, blobId));
}

// Lock and reclaim one candidate blob. The FOR UPDATE serializes against a
// concurrent bind, which locks the same blob row (ensureBlobExists) before
// inserting its binding and clearing dereferencedAt — so either the bind commits
// first (this lock query then sees dereferencedAt cleared and skips) or this
// reclaim commits first (the bind's lock then finds the blob gone and fails
// closed). Either way the reachability re-check cannot miss an in-flight
// re-reference, and a still-referenced blob is revived rather than deleted.
async function reclaimOneBlob(
  db: ApiDatabase,
  blobId: string,
): Promise<ReclaimOutcome> {
  return db.transaction(async (tx) => {
    const lockQuery = tx
      .select({ id: blobs.id, storageKey: blobs.storageKey })
      .from(blobs)
      .where(and(eq(blobs.id, blobId), isNotNull(blobs.dereferencedAt)))
      .limit(1);
    const [blob] = await lockRowForUpdate(lockQuery);
    if (!blob) {
      // Revived or already reclaimed since selection.
      return { kind: "skipped" };
    }

    if (await isBlobReferenced(tx, blobId)) {
      await tx
        .update(blobs)
        .set({ dereferencedAt: null })
        .where(eq(blobs.id, blobId));
      return { kind: "revived" };
    }

    await deleteBlobKeyRows(tx, blobId);
    await tx
      .delete(blobAuditObjects)
      .where(eq(blobAuditObjects.blobId, blobId));
    await tx.delete(blobs).where(eq(blobs.id, blobId));

    return { kind: "reclaimed", storageKey: blob.storageKey };
  });
}

// Hard-deletes blobs that purge soft-deleted (dereferencedAt set) longer than
// the grace period ago and that are still unreferenced, reviving any that were
// re-bound since. Returns the object-store keys whose bytes the caller should
// delete after commit (the workflow stays DB-only). Each blob is reclaimed in
// its own transaction so one contended/failed blob does not block the rest.
export async function runReclaimDereferencedBlobsWorkflow(
  db: ApiDatabase,
  input: ReclaimDereferencedBlobsInput = {},
): Promise<ReclaimDereferencedBlobsResult> {
  const now = input.now ?? new Date();
  const gracePeriodMs = input.gracePeriodMs ?? DEFAULT_GRACE_PERIOD_MS;
  const cutoff = new Date(now.getTime() - gracePeriodMs);
  const limit = normalizeLimit(input.limit);

  const candidates = await db
    .select({ id: blobs.id })
    .from(blobs)
    .where(
      and(isNotNull(blobs.dereferencedAt), lte(blobs.dereferencedAt, cutoff)),
    )
    .orderBy(asc(blobs.dereferencedAt))
    .limit(limit);

  const reclaimedBlobIds: string[] = [];
  const revivedBlobIds: string[] = [];
  const reclaimedStorageKeys: string[] = [];

  for (const candidate of candidates) {
    const outcome = await reclaimOneBlob(db, candidate.id);
    if (outcome.kind === "reclaimed") {
      reclaimedBlobIds.push(candidate.id);
      reclaimedStorageKeys.push(outcome.storageKey);
    } else if (outcome.kind === "revived") {
      revivedBlobIds.push(candidate.id);
    }
  }

  return { reclaimedBlobIds, revivedBlobIds, reclaimedStorageKeys };
}
