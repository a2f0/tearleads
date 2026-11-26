import type { ApiDatabase } from "@tearleads/api-shared/postgres";
import { documentBaselineStages } from "@tearleads/api-shared/schema";
import { and, asc, count, eq, lte } from "drizzle-orm";
import {
  type DocumentBaselineStageKey,
  deleteUncommittedBaselineSegments,
} from "../../../documents/documentBaselineStageStore";

/** Expired stages read per statement; a run reads batch after batch. */
const EXPIRED_STAGE_SWEEP_BATCH = 100;

/**
 * What one run deletes at most, and how long it runs at most. A run drains
 * every expired stage unless one of these stops it first, and then says how
 * many it left. Each stage is its own transaction, deleting up to a stage's
 * cap of rows, so the count alone would not bound a run's time.
 */
const MAX_EXPIRED_STAGES_PER_SWEEP = 10_000;
const EXPIRED_STAGE_SWEEP_BUDGET_MS = 5 * 60 * 1000;

export interface CleanupExpiredDocumentBaselineStagesInput {
  /** Milliseconds a run may take before it stops with work left. */
  readonly budgetMs?: number | undefined;
  /** A millisecond clock, for the budget; the wall clock if absent. */
  readonly clock?: (() => number) | undefined;
  /** Stages a run may read before it stops with work left. */
  readonly maxStages?: number | undefined;
  readonly now?: Date | undefined;
}

interface CleanupExpiredDocumentBaselineStagesResult {
  readonly deletedStages: number;
  readonly failures: readonly unknown[];
  /** Expired stages still stored when the run ended, failed ones included. */
  readonly remainingStages: number;
  readonly scannedStages: number;
}

/**
 * Delete one stage if it is still there and still expired, with what it
 * staged. The stage row is deleted first, which takes its row lock: a
 * request committing the stage holds that lock until it has deleted the row
 * itself, so this delete then finds no row and touches nothing; and when
 * this delete wins, the commit finds no stage and is refused. The segment
 * delete after it skips every segment a request committed.
 */
async function deleteExpiredStage(
  db: ApiDatabase,
  key: DocumentBaselineStageKey,
  now: Date,
): Promise<boolean> {
  return db.transaction(async (executor) => {
    const deleted = await executor
      .delete(documentBaselineStages)
      .where(
        and(
          eq(documentBaselineStages.documentId, key.documentId),
          eq(documentBaselineStages.id, key.baselineId),
          lte(documentBaselineStages.expiresAt, now),
        ),
      )
      .returning({ id: documentBaselineStages.id });
    if (deleted.length === 0) return false;
    await deleteUncommittedBaselineSegments(executor, key);
    return true;
  });
}

/**
 * The next expired stages in a fixed order, past the ones this run could not
 * delete. A deleted stage leaves the list and a failed one stays at its
 * head, since the run reads in this order, so skipping as many rows as have
 * failed reads each stage once.
 */
function listExpiredStages(
  db: ApiDatabase,
  input: { readonly limit: number; readonly now: Date; readonly skip: number },
) {
  return db
    .select({
      baselineId: documentBaselineStages.id,
      documentId: documentBaselineStages.documentId,
    })
    .from(documentBaselineStages)
    .where(lte(documentBaselineStages.expiresAt, input.now))
    .orderBy(
      asc(documentBaselineStages.expiresAt),
      asc(documentBaselineStages.documentId),
      asc(documentBaselineStages.id),
    )
    .limit(input.limit)
    .offset(input.skip);
}

/** Delete each stage of a batch on its own; returns how many went. */
async function deleteExpiredStages(
  db: ApiDatabase,
  batch: readonly DocumentBaselineStageKey[],
  now: Date,
  failures: unknown[],
): Promise<number> {
  let deleted = 0;
  for (const key of batch) {
    try {
      if (await deleteExpiredStage(db, key, now)) deleted += 1;
    } catch (error) {
      failures.push(error);
    }
  }
  return deleted;
}

/**
 * Delete the stages that expired with nothing committing them: a writer
 * that stopped uploading, lost access, or never sent its final segment. Each
 * stage goes in its own transaction, so one that fails is retried by the
 * next run and does not keep the others. The run reads batch after batch
 * until none is left, or until its count or time budget stops it; it then
 * reports how many expired stages remain, so a backlog is seen and the next
 * run takes it up.
 */
export async function cleanupExpiredDocumentBaselineStages(
  db: ApiDatabase,
  input: CleanupExpiredDocumentBaselineStagesInput = {},
): Promise<CleanupExpiredDocumentBaselineStagesResult> {
  const now = input.now ?? new Date();
  const clock = input.clock ?? Date.now;
  const maxStages = input.maxStages ?? MAX_EXPIRED_STAGES_PER_SWEEP;
  const deadline = clock() + (input.budgetMs ?? EXPIRED_STAGE_SWEEP_BUDGET_MS);
  let deletedStages = 0;
  let scannedStages = 0;
  const failures: unknown[] = [];
  while (scannedStages < maxStages && clock() < deadline) {
    const batch = await listExpiredStages(db, {
      limit: Math.min(EXPIRED_STAGE_SWEEP_BATCH, maxStages - scannedStages),
      now,
      skip: failures.length,
    });
    if (batch.length === 0) break;
    scannedStages += batch.length;
    deletedStages += await deleteExpiredStages(db, batch, now, failures);
  }
  const [left] = await db
    .select({ stages: count() })
    .from(documentBaselineStages)
    .where(lte(documentBaselineStages.expiresAt, now));
  return {
    deletedStages,
    failures,
    remainingStages: left?.stages ?? 0,
    scannedStages,
  };
}
