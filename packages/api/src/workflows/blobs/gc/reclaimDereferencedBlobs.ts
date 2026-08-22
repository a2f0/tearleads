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
} from "@symcrypt/api-shared/schema";
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
import {
  lockRowForUpdate,
  wallClockNowExpression,
} from "../../../utils/sqlDialect";
import { selectFairBlobWorkCandidates } from "./fairBlobWorkSelection";

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
}

type ReclaimOutcome =
  | { readonly kind: "skipped" }
  | { readonly kind: "revived" }
  | { readonly kind: "reclaimed" };

interface ReclaimCandidate {
  readonly blobId: string;
  readonly queuedAt: Date;
}

interface ReclaimCandidateRow {
  readonly dereferencedAt: Date | null;
  readonly id: string;
  readonly reclaimAttemptedAt: Date | null;
}

function normalizeLimit(limit: number | undefined): number {
  if (limit === undefined) {
    return DEFAULT_LIMIT;
  }
  if (!Number.isInteger(limit) || limit < 1) {
    return DEFAULT_LIMIT;
  }
  return Math.min(limit, MAX_LIMIT);
}

async function readDatabaseWallClock(db: ApiDatabase): Promise<Date> {
  const [row] = await db
    .select({
      now: wallClockNowExpression().mapWith(blobs.createdAt),
    })
    .from(sql`(select 1) as database_clock`);
  if (!row) {
    throw new Error("Database wall clock query returned no row");
  }
  return row.now;
}

function toNewReclaimCandidates(
  rows: readonly ReclaimCandidateRow[],
  gracePeriodMs: number,
): ReclaimCandidate[] {
  return rows.flatMap((row): ReclaimCandidate[] =>
    row.dereferencedAt === null
      ? []
      : [
          {
            blobId: row.id,
            // Compare the time work became eligible, not when the blob was
            // dereferenced. That puts this queue on the same clock as retries.
            queuedAt: new Date(row.dereferencedAt.getTime() + gracePeriodMs),
          },
        ],
  );
}

function toRetryReclaimCandidates(
  rows: readonly ReclaimCandidateRow[],
): ReclaimCandidate[] {
  return rows.flatMap((row): ReclaimCandidate[] =>
    row.dereferencedAt === null || row.reclaimAttemptedAt === null
      ? []
      : [
          {
            blobId: row.id,
            queuedAt: row.reclaimAttemptedAt,
          },
        ],
  );
}

// Live reachability is intentionally narrower than audit history. Detached
// bindings and attachment audit events preserve metadata, but only an ACTIVE
// binding keeps blob bytes and key material live.
async function isBlobActivelyReferenced(
  executor: DatabaseTransaction,
  blobId: string,
): Promise<boolean> {
  const [binding] = await executor
    .select({ id: attachmentBindings.id })
    .from(attachmentBindings)
    .where(
      and(
        eq(attachmentBindings.blobId, blobId),
        isNull(attachmentBindings.detachedAt),
      ),
    )
    .limit(1);
  return Boolean(binding);
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
  input: {
    readonly blobId: string;
    readonly cutoff: Date;
    readonly prunedAt: Date;
  },
): Promise<ReclaimOutcome> {
  return db.transaction(async (tx) => {
    const lockQuery = tx
      .select({
        byteLength: blobs.byteLength,
        id: blobs.id,
        sha256: blobs.sha256,
        storageKey: blobs.storageKey,
      })
      .from(blobs)
      .where(
        and(
          eq(blobs.id, input.blobId),
          isNotNull(blobs.dereferencedAt),
          lte(blobs.dereferencedAt, input.cutoff),
        ),
      )
      .limit(1);
    const [blob] = await lockRowForUpdate(lockQuery);
    if (!blob) {
      // Revived or already reclaimed since selection.
      return { kind: "skipped" };
    }

    if (await isBlobActivelyReferenced(tx, input.blobId)) {
      await tx
        .update(blobs)
        .set({ dereferencedAt: null, reclaimAttemptedAt: null })
        .where(eq(blobs.id, input.blobId));
      return { kind: "revived" };
    }

    const [auditObject] = await tx
      .select({
        blobId: blobAuditObjects.blobId,
        byteLength: blobAuditObjects.byteLength,
        liveStorageKey: blobAuditObjects.liveStorageKey,
        retentionMode: blobAuditObjects.retentionMode,
        sha256: blobAuditObjects.sha256,
      })
      .from(blobAuditObjects)
      .where(eq(blobAuditObjects.blobId, input.blobId))
      .limit(1);
    if (
      !auditObject ||
      auditObject.byteLength !== blob.byteLength ||
      auditObject.liveStorageKey !== blob.storageKey ||
      auditObject.retentionMode !== "live_only" ||
      auditObject.sha256 !== blob.sha256
    ) {
      throw new Error(
        `Blob ${input.blobId} audit metadata does not match live storage`,
      );
    }

    await deleteBlobKeyRows(tx, input.blobId);
    await tx
      .delete(attachmentBindings)
      .where(eq(attachmentBindings.blobId, input.blobId));
    await tx
      .update(blobAuditObjects)
      .set({
        liveStorageKey: blob.storageKey,
        objectDeletedAt: null,
        prunedAt: input.prunedAt,
      })
      .where(eq(blobAuditObjects.blobId, input.blobId));
    await tx.delete(blobs).where(eq(blobs.id, input.blobId));

    return { kind: "reclaimed" };
  });
}

async function deferFailedBlobReclaim(
  db: ApiDatabase,
  input: {
    readonly blobId: string;
    readonly cutoff: Date;
    readonly retryAt: Date;
  },
): Promise<void> {
  // A corrupt candidate must not remain at the front of every bounded batch.
  // Rotate its retry marker without changing the lifecycle-defining
  // dereference timestamp. The cutoff makes a concurrent revive or fresh
  // detach win and avoids PostgreSQL timestamp round-trip precision equality.
  await db
    .update(blobs)
    .set({ reclaimAttemptedAt: input.retryAt })
    .where(
      and(
        eq(blobs.id, input.blobId),
        isNotNull(blobs.dereferencedAt),
        lte(blobs.dereferencedAt, input.cutoff),
      ),
    );
}

// Prunes live database state for blobs dereferenced longer than the grace
// period, retaining the storage key on the audit row as a durable physical-
// deletion work item. Each candidate is rechecked against the cutoff under the
// blob-row lock. A failed candidate records its attempt separately so bounded
// batches keep advancing without rewriting when the blob became unreachable.
export async function runReclaimDereferencedBlobsWorkflow(
  db: ApiDatabase,
  input: ReclaimDereferencedBlobsInput = {},
): Promise<ReclaimDereferencedBlobsResult> {
  // Dereference timestamps are written by the database after reachability
  // locks. Use that same clock for the default cutoff so API-host skew cannot
  // shorten the grace period. Explicit `now` remains a deterministic test and
  // maintenance override.
  const now = input.now ?? (await readDatabaseWallClock(db));
  const gracePeriodMs = input.gracePeriodMs ?? DEFAULT_GRACE_PERIOD_MS;
  const cutoff = new Date(now.getTime() - gracePeriodMs);
  const limit = normalizeLimit(input.limit);

  const candidateColumns = {
    dereferencedAt: blobs.dereferencedAt,
    id: blobs.id,
    reclaimAttemptedAt: blobs.reclaimAttemptedAt,
  };
  const eligiblePredicate = and(
    isNotNull(blobs.dereferencedAt),
    lte(blobs.dereferencedAt, cutoff),
  );
  const [newRows, retryRows] = await Promise.all([
    db
      .select(candidateColumns)
      .from(blobs)
      .where(and(eligiblePredicate, isNull(blobs.reclaimAttemptedAt)))
      .orderBy(asc(blobs.dereferencedAt), asc(blobs.id))
      .limit(limit),
    db
      .select(candidateColumns)
      .from(blobs)
      .where(and(eligiblePredicate, isNotNull(blobs.reclaimAttemptedAt)))
      .orderBy(
        asc(blobs.reclaimAttemptedAt),
        asc(blobs.dereferencedAt),
        asc(blobs.id),
      )
      .limit(limit),
  ]);
  const candidates = selectFairBlobWorkCandidates(
    toNewReclaimCandidates(newRows, gracePeriodMs),
    toRetryReclaimCandidates(retryRows),
    limit,
  );

  const reclaimedBlobIds: string[] = [];
  const revivedBlobIds: string[] = [];
  const failures: unknown[] = [];

  for (const candidate of candidates) {
    try {
      const outcome = await reclaimOneBlob(db, {
        blobId: candidate.blobId,
        cutoff,
        prunedAt: now,
      });
      if (outcome.kind === "reclaimed") {
        reclaimedBlobIds.push(candidate.blobId);
      } else if (outcome.kind === "revived") {
        revivedBlobIds.push(candidate.blobId);
      }
    } catch (error) {
      failures.push(error);
      try {
        await deferFailedBlobReclaim(db, {
          blobId: candidate.blobId,
          cutoff,
          retryAt: now,
        });
      } catch (deferError) {
        failures.push(deferError);
      }
    }
  }

  if (failures.length > 0) {
    const firstFailure = failures[0];
    const detail =
      firstFailure instanceof Error ? `: ${firstFailure.message}` : "";
    throw new AggregateError(
      failures,
      `Blob reclamation encountered ${failures.length} failure(s)${detail}`,
    );
  }

  return { reclaimedBlobIds, revivedBlobIds };
}
