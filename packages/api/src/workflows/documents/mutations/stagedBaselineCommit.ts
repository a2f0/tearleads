import type { DatabaseSession } from "@tearleads/api-shared/postgres";
import { decodeVersionVector } from "@tearleads/loro";
import type { DocumentOutgoingUpdate } from "@tearleads/validators/request";
import {
  DOCUMENT_BASELINE_STAGE_ERROR_CODES,
  type DocumentBaselineStageErrorCode,
} from "@tearleads/validators/response";
import {
  type BaselineSegmentHistory,
  baselineSegmentContinues,
  type DocumentBaselineGroupFault,
  documentBaselineGroupFaultMessage,
  readBaselineSegmentHistory,
} from "../../../documents/documentBaselineGroup";
import {
  type DocumentBaselineStageRow,
  judgeDocumentBaselineStage,
} from "../../../documents/documentBaselineStageState";
import {
  lockDocumentBaselineStageRow,
  readStagedBaselineFrontier,
} from "../../../documents/documentBaselineStageStore";
import { committedFrontierAfterBaselineCursor } from "./committedDocumentUpdates";
import type { DocumentMutationError } from "./errors";
import { documentBaselineGroupInvalid } from "./outgoingBaselineGroup";

/**
 * A staged baseline a request is committing: its stage row, locked for the
 * rest of the transaction, and the final segment the request carries, which
 * closes the group the stage's segments open.
 */
export interface StagedBaselineCommit {
  readonly final: DocumentOutgoingUpdate;
  /** The final segment's spans, walked against the stage's frontier. */
  readonly finalHistory: BaselineSegmentHistory;
  readonly stage: DocumentBaselineStageRow;
}

function groupFault(fault: DocumentBaselineGroupFault): DocumentMutationError {
  return documentBaselineGroupInvalid(documentBaselineGroupFaultMessage(fault));
}

function stageRefusal(
  code: DocumentBaselineStageErrorCode,
  reason: string,
): DocumentMutationError {
  return documentBaselineGroupInvalid(reason, code);
}

/**
 * A request that names a stage carries the staged baseline's final segment
 * and no other segment of it: the earlier ones are the stage's.
 */
function requireFinalSegment(
  segments: readonly DocumentOutgoingUpdate[],
  baselineStageId: string,
): DocumentOutgoingUpdate {
  const [final, ...others] = segments;
  if (!final || others.length > 0) {
    throw documentBaselineGroupInvalid(
      "a request that commits a staged baseline carries its final segment alone",
    );
  }
  if (final.baselineId !== baselineStageId) throw groupFault("mixed_baseline");
  return final;
}

/**
 * The stage as the committing request may use it: the caller's, unexpired,
 * for the epoch the request writes at, with the final segment next in line.
 * Each failure is the group rule it breaks, with the stage's own code so the
 * writer knows what its staged segments are worth.
 */
function requireCommittableStage(
  input: {
    readonly final: DocumentOutgoingUpdate;
    readonly now: Date;
    readonly requestContentKeyEpoch: number;
    readonly userId: string;
  },
  row: DocumentBaselineStageRow | undefined,
): DocumentBaselineStageRow {
  const state = judgeDocumentBaselineStage(row, input);
  if (state.status === "absent") {
    throw stageRefusal(
      DOCUMENT_BASELINE_STAGE_ERROR_CODES.notFound,
      "its stage does not exist",
    );
  }
  if (state.status === "expired") {
    throw stageRefusal(
      DOCUMENT_BASELINE_STAGE_ERROR_CODES.expired,
      "its stage expired",
    );
  }
  const { stage } = state;
  if (stage.contentKeyEpoch !== input.requestContentKeyEpoch) {
    throw stageRefusal(
      DOCUMENT_BASELINE_STAGE_ERROR_CODES.epochStale,
      "its stage is for another content-key epoch",
    );
  }
  if (input.final.baselineSegmentIndex !== stage.nextSegmentIndex) {
    throw stageRefusal(
      DOCUMENT_BASELINE_STAGE_ERROR_CODES.segmentOutOfOrder,
      documentBaselineGroupFaultMessage("segment_out_of_order"),
    );
  }
  return stage;
}

/**
 * The group rules the final segment answers for, with the stage standing
 * for the segments before it (`judgeDocumentBaselineGroup` holds a request's
 * own segments to the same ones): its count is the number of segments, it
 * continues the staged history gapless, it is empty only as the whole of a
 * cursored baseline, and its digest is the stage's chain. The staged
 * segments were each held to the walk when staged, and none of them seals.
 */
async function requireFinalSegmentClosesStage(
  executor: DatabaseSession,
  documentId: string,
  stage: DocumentBaselineStageRow,
  final: DocumentOutgoingUpdate,
): Promise<BaselineSegmentHistory> {
  if (final.baselineSegmentCount !== stage.nextSegmentIndex + 1) {
    throw groupFault("segment_count_mismatch");
  }
  const history = readBaselineSegmentHistory(final);
  if (!history) throw groupFault("history_not_gapless");
  const frontier = await readStagedBaselineFrontier(
    executor,
    { baselineId: stage.id, documentId },
    [
      ...history.spans.map((span) => span.peerId),
      ...history.dependencies.map(([peerId]) => peerId),
    ],
  );
  if (
    !baselineSegmentContinues((peerId) => frontier.get(peerId) ?? 0, history)
  ) {
    throw groupFault("history_not_gapless");
  }
  if (history.spans.length === 0) {
    if (stage.nextSegmentIndex > 0) throw groupFault("empty_segment");
    if (final.coversThroughUpdateId === undefined) {
      throw groupFault("cursor_missing");
    }
  }
  if (final.baselineSegmentsDigest !== stage.segmentsDigest) {
    throw groupFault("digest_mismatch");
  }
  return history;
}

/**
 * Lock the stage a request commits and hold the request's final segment to
 * it. The caller holds the document head lock, so the stage is locked after
 * it, as every commit does; a stage write locks only the stage row, so the
 * two orders never cross. From here to the end of the transaction no
 * segment can be staged, no header re-signed, and the sweep cannot delete
 * the stage.
 */
export async function lockStagedBaselineForCommit(
  executor: DatabaseSession,
  input: {
    readonly baselineStageId: string;
    readonly documentId: string;
    readonly now?: Date | undefined;
    readonly requestContentKeyEpoch: number;
    /** The baseline segments the request carries. */
    readonly segments: readonly DocumentOutgoingUpdate[];
    readonly userId: string;
  },
): Promise<StagedBaselineCommit> {
  const final = requireFinalSegment(input.segments, input.baselineStageId);
  const stage = requireCommittableStage(
    {
      final,
      now: input.now ?? new Date(),
      requestContentKeyEpoch: input.requestContentKeyEpoch,
      userId: input.userId,
    },
    await lockDocumentBaselineStageRow(executor, {
      baselineId: input.baselineStageId,
      documentId: input.documentId,
    }),
  );
  return {
    final,
    finalHistory: await requireFinalSegmentClosesStage(
      executor,
      input.documentId,
      stage,
      final,
    ),
    stage,
  };
}

/**
 * Prove that a staged baseline covers the committed frontier after its
 * signed cursor, the same frontier an inline group must cover
 * (`committedFrontierAfterBaselineCursor`). What the group reaches on a peer
 * is where its spans end: the staged segments' spans, each walked gapless
 * from the stage's frontier when it was staged, then the final segment's,
 * walked from there by `lockStagedBaselineForCommit`. No vector a segment
 * declares is read as coverage. Only the peers the frontier names are
 * looked up, so the cost follows what was committed after the cursor, not
 * the baseline's size. The caller holds the document head lock and the
 * stage's row lock, so neither side moves before the commit.
 */
export async function assertStagedBaselineCoversCommittedFrontier(
  executor: DatabaseSession,
  input: {
    readonly commit: StagedBaselineCommit;
    readonly documentId: string;
    /** The refusal of the route the request came by. */
    readonly uncovered: () => DocumentMutationError;
  },
): Promise<void> {
  const { final, finalHistory, stage } = input.commit;
  const committed = [
    ...decodeVersionVector(
      await committedFrontierAfterBaselineCursor(executor, {
        coversThroughUpdateId: final.coversThroughUpdateId,
        documentId: input.documentId,
      }),
    ).toJSON(),
  ].filter(([, counter]) => counter > 0);
  const reached = await readStagedBaselineFrontier(
    executor,
    { baselineId: stage.id, documentId: input.documentId },
    committed.map(([peerId]) => peerId),
  );
  for (const span of finalHistory.spans) {
    reached.set(span.peerId, span.endCounter);
  }
  if (
    committed.some(([peerId, counter]) => (reached.get(peerId) ?? 0) < counter)
  ) {
    throw input.uncovered();
  }
}
