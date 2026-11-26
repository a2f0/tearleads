import type { ApiDatabase } from "@tearleads/api-shared/postgres";
import { documentBaselineStages } from "@tearleads/api-shared/schema";
import { and, asc, eq, lte } from "drizzle-orm";
import {
  type DocumentBaselineStageKey,
  deleteUncommittedBaselineSegments,
} from "../../../documents/documentBaselineStageStore";

/** Expired stages one sweep deletes; the rest wait for the next run. */
const DEFAULT_EXPIRED_STAGE_SWEEP_LIMIT = 100;

export interface CleanupExpiredDocumentBaselineStagesInput {
  readonly limit?: number | undefined;
  readonly now?: Date | undefined;
}

interface CleanupExpiredDocumentBaselineStagesResult {
  readonly deletedStages: number;
  readonly failures: readonly unknown[];
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
 * Delete the stages that expired with nothing committing them: a writer
 * that stopped uploading, lost access, or never sent its final segment. Each
 * stage goes in its own transaction, so one that fails is retried by the
 * next run and does not keep the others.
 */
export async function cleanupExpiredDocumentBaselineStages(
  db: ApiDatabase,
  input: CleanupExpiredDocumentBaselineStagesInput = {},
): Promise<CleanupExpiredDocumentBaselineStagesResult> {
  const now = input.now ?? new Date();
  const expired = await db
    .select({
      baselineId: documentBaselineStages.id,
      documentId: documentBaselineStages.documentId,
    })
    .from(documentBaselineStages)
    .where(lte(documentBaselineStages.expiresAt, now))
    .orderBy(asc(documentBaselineStages.expiresAt))
    .limit(input.limit ?? DEFAULT_EXPIRED_STAGE_SWEEP_LIMIT);
  let deletedStages = 0;
  const failures: unknown[] = [];
  for (const key of expired) {
    try {
      if (await deleteExpiredStage(db, key, now)) deletedStages += 1;
    } catch (error) {
      failures.push(error);
    }
  }
  return { deletedStages, failures, scannedStages: expired.length };
}
