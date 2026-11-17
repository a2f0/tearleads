import type { ApiDatabase } from "@tearleads/api-shared/postgres";
import { blobs } from "@tearleads/api-shared/schema";
import {
  and,
  asc,
  eq,
  inArray,
  isNotNull,
  isNull,
  lte,
  or,
  sql,
} from "drizzle-orm";
import { wallClockNowExpression } from "../../../utils/postgresSql";
import { selectFairBlobWorkCandidates } from "./fairBlobWorkSelection";
import { DEFAULT_BLOB_GC_GRACE_PERIOD_MS } from "./gracePeriod";
import { RECLAIM_CHUNK_SIZE, reclaimBlobChunk } from "./reclaimBlobChunk";

const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 1000;

export interface ReclaimDereferencedBlobsInput {
  /** Restricts both database reclamation and object deletion to these blobs. */
  readonly blobIds?: readonly string[];
  readonly now?: Date;
  readonly gracePeriodMs?: number;
  readonly limit?: number;
}

interface ReclaimDereferencedBlobsResult {
  readonly reclaimedBlobIds: string[];
  readonly revivedBlobIds: string[];
}

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

export async function deferFailedBlobReclaim(
  db: ApiDatabase,
  input: {
    readonly blobId: string;
    readonly cutoff: Date;
    readonly retryAt: Date;
  },
): Promise<void> {
  // A corrupt candidate must not remain at the front of every bounded batch.
  // Rotate its retry marker without changing the lifecycle-defining
  // dereference timestamp. A late failure from an older overlapping sweep
  // cannot move a newer marker backward. The cutoff makes a concurrent revive
  // or fresh detach win and avoids PostgreSQL timestamp precision equality.
  await db
    .update(blobs)
    .set({ reclaimAttemptedAt: input.retryAt })
    .where(
      and(
        eq(blobs.id, input.blobId),
        isNotNull(blobs.dereferencedAt),
        lte(blobs.dereferencedAt, input.cutoff),
        or(
          isNull(blobs.reclaimAttemptedAt),
          lte(blobs.reclaimAttemptedAt, input.retryAt),
        ),
      ),
    );
}

// Prunes live database state for blobs dereferenced longer than the grace
// period, retaining the storage key on the audit row as a durable physical-
// deletion work item. Candidates are reclaimed in chunks, each rechecked
// against the cutoff under its blob-row locks (`reclaimBlobChunk`). A failed
// candidate records its attempt separately so bounded batches keep advancing
// without rewriting when the blob became unreachable.
export async function runReclaimDereferencedBlobsWorkflow(
  db: ApiDatabase,
  input: ReclaimDereferencedBlobsInput = {},
): Promise<ReclaimDereferencedBlobsResult> {
  // Dereference timestamps are written by the database after reachability
  // locks. Use that same clock for the default cutoff so API-host skew cannot
  // shorten the grace period. Explicit `now` remains a deterministic test and
  // maintenance override.
  const now = input.now ?? (await readDatabaseWallClock(db));
  const gracePeriodMs = input.gracePeriodMs ?? DEFAULT_BLOB_GC_GRACE_PERIOD_MS;
  const cutoff = new Date(now.getTime() - gracePeriodMs);
  const limit = normalizeLimit(input.limit);
  const scopedBlobIds = input.blobIds ? [...new Set(input.blobIds)] : undefined;
  if (scopedBlobIds?.length === 0) {
    return { reclaimedBlobIds: [], revivedBlobIds: [] };
  }

  const candidateColumns = {
    dereferencedAt: blobs.dereferencedAt,
    id: blobs.id,
    reclaimAttemptedAt: blobs.reclaimAttemptedAt,
  };
  const eligiblePredicate = and(
    isNotNull(blobs.dereferencedAt),
    lte(blobs.dereferencedAt, cutoff),
    scopedBlobIds ? inArray(blobs.id, scopedBlobIds) : undefined,
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

  return reclaimCandidates(
    db,
    candidates.map((candidate) => candidate.blobId),
    { cutoff, now },
  );
}

/** Reclaims candidates chunk by chunk, keeping their order in the result. */
async function reclaimCandidates(
  db: ApiDatabase,
  blobIds: readonly string[],
  input: { readonly cutoff: Date; readonly now: Date },
): Promise<ReclaimDereferencedBlobsResult> {
  const reclaimedBlobIds: string[] = [];
  const revivedBlobIds: string[] = [];
  const failures: unknown[] = [];
  for (let offset = 0; offset < blobIds.length; offset += RECLAIM_CHUNK_SIZE) {
    const chunk = blobIds.slice(offset, offset + RECLAIM_CHUNK_SIZE);
    const outcomes = await reclaimBlobChunk(db, {
      blobIds: chunk,
      cutoff: input.cutoff,
    });
    for (const blobId of chunk) {
      const outcome = outcomes.get(blobId);
      if (outcome?.kind === "failed") {
        failures.push(outcome.error);
        await deferFailedBlobReclaim(db, {
          blobId,
          cutoff: input.cutoff,
          retryAt: input.now,
        }).catch((deferError: unknown) => failures.push(deferError));
      } else if (outcome?.kind === "reclaimed") {
        reclaimedBlobIds.push(blobId);
      } else if (outcome?.kind === "revived") {
        revivedBlobIds.push(blobId);
      }
    }
  }

  throwIfReclaimFailed(failures);
  return { reclaimedBlobIds, revivedBlobIds };
}

function throwIfReclaimFailed(failures: readonly unknown[]): void {
  if (failures.length === 0) return;
  const firstFailure = failures[0];
  const detail =
    firstFailure instanceof Error ? `: ${firstFailure.message}` : "";
  throw new AggregateError(
    failures,
    `Blob reclamation encountered ${failures.length} failure(s)${detail}`,
  );
}
