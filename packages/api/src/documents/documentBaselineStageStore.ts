import type { DatabaseSession } from "@tearleads/api-shared/postgres";
import {
  documentBaselineSegmentSpans,
  documentBaselineSegments,
  documentBaselineStages,
  documentUpdates,
} from "@tearleads/api-shared/schema";
import { and, eq, exists, isNull, max, not, sql } from "drizzle-orm";
import type { DocumentBaselineStageRow } from "./documentBaselineStageState";

/** A stage's identity: its baseline id names it only within its document. */
export interface DocumentBaselineStageKey {
  readonly baselineId: string;
  readonly documentId: string;
}

function stageRowIs(key: DocumentBaselineStageKey) {
  return and(
    eq(documentBaselineStages.documentId, key.documentId),
    eq(documentBaselineStages.id, key.baselineId),
  );
}

function stagedSegmentOf(key: DocumentBaselineStageKey) {
  return and(
    eq(documentBaselineSegments.documentId, key.documentId),
    eq(documentBaselineSegments.baselineId, key.baselineId),
  );
}

function stagedSpanOf(key: DocumentBaselineStageKey) {
  return and(
    eq(documentBaselineSegmentSpans.documentId, key.documentId),
    eq(documentBaselineSegmentSpans.baselineId, key.baselineId),
  );
}

export async function readDocumentBaselineStageRow(
  executor: DatabaseSession,
  key: DocumentBaselineStageKey,
): Promise<DocumentBaselineStageRow | undefined> {
  const [row] = await executor
    .select()
    .from(documentBaselineStages)
    .where(stageRowIs(key))
    .limit(1);
  return row;
}

/**
 * The stage row, locked for the rest of the transaction. Every write to a
 * stage, the commit that consumes it and the deletes that remove it take
 * this lock first, so they run one at a time: a commit and a sweep of the
 * same stage cannot both proceed from one read of it.
 */
export async function lockDocumentBaselineStageRow(
  executor: DatabaseSession,
  key: DocumentBaselineStageKey,
): Promise<DocumentBaselineStageRow | undefined> {
  const [row] = await executor
    .select()
    .from(documentBaselineStages)
    .where(stageRowIs(key))
    .limit(1)
    .for("update");
  return row;
}

/** The segment a stage holds at `segmentIndex`, as its header binds it. */
export async function readStagedSegmentAt(
  executor: DatabaseSession,
  stage: Pick<DocumentBaselineStageRow, "documentId" | "id">,
  segmentIndex: number,
) {
  const [held] = await executor
    .select({
      header: documentBaselineSegments.header,
      updateId: documentBaselineSegments.updateId,
    })
    .from(documentBaselineSegments)
    .where(
      and(
        stagedSegmentOf({ baselineId: stage.id, documentId: stage.documentId }),
        eq(documentBaselineSegments.segmentIndex, segmentIndex),
      ),
    )
    .limit(1);
  return held;
}

/**
 * Where the stage's segments leave each of `peerIds`: the highest counter
 * staged for it, zero when none. A staged segment starts every peer it
 * carries at this frontier, so a peer's staged spans run gapless from zero
 * and the frontier is exactly what the stage carries of it. The peers go as
 * one parameter: a segment names as many as its bytes admit.
 */
export async function readStagedBaselineFrontier(
  executor: DatabaseSession,
  key: DocumentBaselineStageKey,
  peerIds: readonly string[],
): Promise<Map<string, number>> {
  const frontier = new Map<string, number>();
  if (peerIds.length === 0) return frontier;
  const peerIdsJson = JSON.stringify([...new Set(peerIds)]);
  const rows = await executor
    .select({
      endCounter: max(documentBaselineSegmentSpans.endCounter),
      peerId: documentBaselineSegmentSpans.peerId,
    })
    .from(documentBaselineSegmentSpans)
    .where(
      and(
        stagedSpanOf(key),
        sql`${documentBaselineSegmentSpans.peerId} in (select jsonb_array_elements_text(${peerIdsJson}::jsonb))`,
      ),
    )
    .groupBy(documentBaselineSegmentSpans.peerId);
  for (const row of rows) frontier.set(row.peerId, row.endCounter ?? 0);
  return frontier;
}

/**
 * A staged row that a commit left as its update's payload: an update of the
 * same document and baseline under the row's id, holding no payload of its
 * own. An update that merely shares the id (an ordinary one, or a segment
 * sent inline) reads nothing from the staged row and does not keep it.
 */
function isCommittedPayload(executor: DatabaseSession) {
  return exists(
    executor
      .select({ id: documentUpdates.id })
      .from(documentUpdates)
      .where(
        and(
          eq(documentUpdates.id, documentBaselineSegments.updateId),
          eq(documentUpdates.documentId, documentBaselineSegments.documentId),
          eq(documentUpdates.baselineId, documentBaselineSegments.baselineId),
          isNull(documentUpdates.encryptedData),
        ),
      ),
  );
}

/**
 * Delete what a stage staged and no request committed: its span rows, and
 * each segment row that is not a committed update's payload. A committed
 * segment's row is never deleted here, whatever stage later names the same
 * baseline id. The caller holds the stage's row lock or has deleted its row
 * in this transaction.
 */
export async function deleteUncommittedBaselineSegments(
  executor: DatabaseSession,
  key: DocumentBaselineStageKey,
): Promise<void> {
  await executor.delete(documentBaselineSegmentSpans).where(stagedSpanOf(key));
  await executor
    .delete(documentBaselineSegments)
    .where(and(stagedSegmentOf(key), not(isCommittedPayload(executor))));
}

/** Delete a stage's row and everything it staged that is not committed. */
export async function deleteDocumentBaselineStage(
  executor: DatabaseSession,
  key: DocumentBaselineStageKey,
): Promise<void> {
  await executor.delete(documentBaselineStages).where(stageRowIs(key));
  await deleteUncommittedBaselineSegments(executor, key);
}
