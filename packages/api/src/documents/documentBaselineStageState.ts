import type { documentBaselineStages } from "@tearleads/api-shared/schema";
import {
  DOCUMENT_BASELINE_STAGE_IDLE_SECONDS,
  DOCUMENT_BASELINE_STAGE_MAX_SECONDS,
} from "@tearleads/validators/util";
import type { InferSelectModel } from "drizzle-orm";

export type DocumentBaselineStageRow = InferSelectModel<
  typeof documentBaselineStages
>;

/**
 * What a stage is to one caller at one instant. A stage another user owns is
 * `absent` to this caller, as a missing one is: a baseline id names a stage
 * only to its owner. An `expired` stage still has its row, until its owner
 * replaces or abandons it or the sweep deletes it, and nothing can be staged
 * to it or committed from it.
 */
export type DocumentBaselineStageState =
  | { readonly status: "absent" }
  | { readonly stage: DocumentBaselineStageRow; readonly status: "expired" }
  | { readonly stage: DocumentBaselineStageRow; readonly status: "open" };

/**
 * Judge the stage row a request read, which it locked if it goes on to
 * write: a stage row leaves `open` only by expiring or by being deleted, and
 * both the sweep and a commit take the row lock first.
 */
export function judgeDocumentBaselineStage(
  row: DocumentBaselineStageRow | undefined,
  input: { readonly now: Date; readonly userId: string },
): DocumentBaselineStageState {
  if (!row || row.ownerUserId !== input.userId) return { status: "absent" };
  return row.expiresAt.getTime() <= input.now.getTime()
    ? { stage: row, status: "expired" }
    : { stage: row, status: "open" };
}

/** Where a segment sent to a stage falls against what the stage holds. */
export type StagedSegmentPlacement =
  | { readonly status: "append" }
  | { readonly nextSegmentIndex: number; readonly status: "out_of_order" }
  | { readonly status: "staged" };

/**
 * Segments are staged strictly in order: the stage's next index appends, an
 * index already staged is a retry to compare with what is held, and any
 * later one is out of order.
 */
export function placeStagedSegment(
  stage: Pick<DocumentBaselineStageRow, "nextSegmentIndex">,
  segmentIndex: number,
): StagedSegmentPlacement {
  if (segmentIndex === stage.nextSegmentIndex) return { status: "append" };
  return segmentIndex < stage.nextSegmentIndex
    ? { status: "staged" }
    : { nextSegmentIndex: stage.nextSegmentIndex, status: "out_of_order" };
}

/**
 * When a stage written to at `now` expires: an idle period later, and never
 * past the maximum lifetime after it opened.
 */
export function documentBaselineStageExpiry(createdAt: Date, now: Date): Date {
  return new Date(
    Math.min(
      now.getTime() + DOCUMENT_BASELINE_STAGE_IDLE_SECONDS * 1000,
      createdAt.getTime() + DOCUMENT_BASELINE_STAGE_MAX_SECONDS * 1000,
    ),
  );
}
